-- =============================================================================
-- Meetings: one booking engine with Google Calendar, booking links and CEO approval
--
--  * meetings / meeting_attendees      every appointment, demo, interview, meeting and CEO meeting, with who takes part
--  * google_calendar_connections       each employee connects their OWN Google account (OAuth); the refresh token is encrypted by the
--                                      server (GOOGLE_TOKEN_KEY) and only the service role can read this table
--  * meeting_booking_types             booking links ("/book/<slug>"): a customer, lead or candidate picks a free slot of the host
--  * meeting_host_settings / meeting_availability   the host's time zone and weekly working hours (the slots a link offers)
--  * meeting_delegates                 people a host (the CEO / Super Admin) lets approve their meeting requests
--  * meeting_events                    history of every change (append-only)
--  * meeting_mail_outbox               e-mails to people outside the company (confirmation, reminder, cancellation), sent by the server
--  * meeting_reminders                 reminders already given (24 h and 1 h before), so each is given once
--
-- Meetings with a Super Admin (the CEO) are REQUESTS until the CEO or a delegate approves them; only approved meetings go on the CEO's
-- calendar. The existing Business Associate demos, recruitment interviews and employee-HR meetings are mirrored into meetings by
-- triggers (their own screens stay the place to change them), so they reach Google Calendar and the one calendar too.
--
-- Additive and re-runnable. Nothing existing is changed or deleted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.google_calendar_connections (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  google_email text check (google_email is null or length(google_email) <= 320),
  refresh_token_enc text not null check (length(refresh_token_enc) <= 4000),
  scopes text check (scopes is null or length(scopes) <= 2000),
  calendar_id text not null default 'primary' check (length(calendar_id) <= 300),
  status text not null default 'CONNECTED' check (status in ('CONNECTED', 'NEEDS_RECONNECT')),
  last_error text check (last_error is null or length(last_error) <= 500),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_host_settings (
  host_id uuid primary key references public.profiles (id) on delete cascade,
  timezone text not null default 'Asia/Kolkata' check (length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_availability (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),          -- 0 = Sunday ... 6 = Saturday
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index if not exists meeting_availability_host_idx on public.meeting_availability (host_id, weekday);

create table if not exists public.meeting_booking_types (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$'),
  title text not null check (length(btrim(title)) between 2 and 120),
  description text check (description is null or length(description) <= 2000),
  kind text not null default 'APPOINTMENT' check (kind in ('APPOINTMENT', 'DEMO', 'MEETING', 'INTERVIEW', 'CEO_MEETING')),
  duration_minutes integer not null default 30 check (duration_minutes between 10 and 480),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 120),
  min_notice_minutes integer not null default 120 check (min_notice_minutes between 0 and 20160),
  max_days_ahead integer not null default 30 check (max_days_ahead between 1 and 180),
  mode text not null default 'GOOGLE_MEET' check (mode in ('GOOGLE_MEET', 'IN_PERSON', 'PHONE')),
  location text check (location is null or length(location) <= 300),
  requires_approval boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meeting_booking_types_host_idx on public.meeting_booking_types (host_id);

create table if not exists public.meeting_delegates (
  host_id uuid not null references public.profiles (id) on delete cascade,
  delegate_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (host_id, delegate_id),
  check (host_id <> delegate_id)
);

create sequence if not exists public.meeting_reference_seq;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('MTG-' || lpad(nextval('public.meeting_reference_seq')::text, 6, '0')),
  kind text not null check (kind in ('APPOINTMENT', 'DEMO', 'MEETING', 'INTERVIEW', 'CEO_MEETING', 'HR_MEETING')),
  title text not null check (length(btrim(title)) between 2 and 200),
  description text check (description is null or length(description) <= 4000),
  host_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Kolkata' check (length(timezone) between 1 and 64),
  mode text not null default 'GOOGLE_MEET' check (mode in ('GOOGLE_MEET', 'ONLINE_LINK', 'IN_PERSON', 'PHONE')),
  location text check (location is null or length(location) <= 500),
  meet_link text check (meet_link is null or (length(meet_link) <= 500 and meet_link ~* '^https://[^\s]+$')),
  status text not null default 'SCHEDULED' check (status in ('REQUESTED', 'PROPOSED', 'SCHEDULED', 'DECLINED', 'CANCELLED', 'COMPLETED')),
  requires_approval boolean not null default false,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 1000),
  cancelled_by uuid references public.profiles (id) on delete set null,
  booking_type_id uuid references public.meeting_booking_types (id) on delete set null,
  booked_via text not null default 'STAFF' check (booked_via in ('STAFF', 'BOOKING_LINK', 'SYSTEM')),
  source_type text check (source_type is null or source_type in ('ba_demo', 'career_interview', 'employee_meeting')),
  source_id uuid,
  customer_id uuid references public.customers (id) on delete set null,
  google_event_id text check (google_event_id is null or length(google_event_id) <= 1024),
  google_calendar_id text check (google_calendar_id is null or length(google_calendar_id) <= 300),
  google_sync_status text not null default 'PENDING'
    check (google_sync_status in ('PENDING', 'SYNCED', 'FAILED', 'NOT_CONNECTED', 'SKIPPED')),
  google_sync_error text check (google_sync_error is null or length(google_sync_error) <= 500),
  google_sync_attempts integer not null default 0,
  google_sync_after timestamptz not null default now(),
  google_synced_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '12 hours'),
  check ((proposed_starts_at is null) = (proposed_ends_at is null)),
  check ((source_type is null) = (source_id is null))
);
create unique index if not exists meetings_source_key on public.meetings (source_type, source_id) where source_type is not null;
create index if not exists meetings_host_time_idx on public.meetings (host_id, starts_at);
create index if not exists meetings_created_by_idx on public.meetings (created_by, starts_at);
create index if not exists meetings_sync_idx on public.meetings (google_sync_status, google_sync_after) where google_sync_status in ('PENDING', 'FAILED');
create index if not exists meetings_upcoming_idx on public.meetings (starts_at) where status = 'SCHEDULED';

create table if not exists public.meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  email text check (email is null or (length(email) <= 320 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  name text check (name is null or length(name) <= 200),
  phone text check (phone is null or length(phone) <= 40),
  role text not null default 'REQUIRED' check (role in ('REQUIRED', 'OPTIONAL', 'EXTERNAL')),
  response text not null default 'NEEDS_ACTION' check (response in ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE')),
  created_at timestamptz not null default now(),
  check (profile_id is not null or email is not null)
);
create unique index if not exists meeting_attendees_profile_key on public.meeting_attendees (meeting_id, profile_id) where profile_id is not null;
create unique index if not exists meeting_attendees_email_key on public.meeting_attendees (meeting_id, lower(email)) where profile_id is null;
create index if not exists meeting_attendees_profile_idx on public.meeting_attendees (profile_id);

create table if not exists public.meeting_events (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind ~ '^[A-Z][A-Z_]{1,40}$'),
  note text check (note is null or length(note) <= 1000),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists meeting_events_meeting_idx on public.meeting_events (meeting_id, id);

create table if not exists public.meeting_mail_outbox (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  to_email text not null check (length(to_email) <= 320),
  to_name text check (to_name is null or length(to_name) <= 200),
  kind text not null check (kind in ('REQUEST_RECEIVED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'DECLINED', 'PROPOSED', 'REMINDER_24H', 'REMINDER_1H')),
  meeting_version integer not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts integer not null default 0,
  last_error text check (last_error is null or length(last_error) <= 500),
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists meeting_mail_outbox_key on public.meeting_mail_outbox (meeting_id, lower(to_email), kind, meeting_version);
create index if not exists meeting_mail_outbox_due_idx on public.meeting_mail_outbox (status, send_after) where status in ('PENDING', 'FAILED', 'SENDING');

create table if not exists public.meeting_reminders (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  kind text not null check (kind in ('24H', '1H')),
  starts_at timestamptz not null,                    -- a rescheduled meeting is reminded again
  created_at timestamptz not null default now(),
  primary key (meeting_id, kind, starts_at)
);

-- nobody reads or writes these tables directly: the functions below (and the server, with the service role) do
alter table public.google_calendar_connections enable row level security;
alter table public.meeting_host_settings enable row level security;
alter table public.meeting_availability enable row level security;
alter table public.meeting_booking_types enable row level security;
alter table public.meeting_delegates enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.meeting_events enable row level security;
alter table public.meeting_mail_outbox enable row level security;
alter table public.meeting_reminders enable row level security;
revoke all on public.google_calendar_connections, public.meeting_host_settings, public.meeting_availability, public.meeting_booking_types,
  public.meeting_delegates, public.meetings, public.meeting_attendees, public.meeting_events, public.meeting_mail_outbox,
  public.meeting_reminders from public, anon, authenticated;
revoke all on sequence public.meeting_reference_seq from public, anon, authenticated;
grant all on public.google_calendar_connections, public.meeting_host_settings, public.meeting_availability, public.meeting_booking_types,
  public.meeting_delegates, public.meetings, public.meeting_attendees, public.meeting_events, public.meeting_mail_outbox,
  public.meeting_reminders to service_role;
grant usage on sequence public.meeting_reference_seq to service_role;

-- the history never changes
create or replace function private.tg_meeting_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then           -- the meeting itself being deleted (cascade)
    return old;
  end if;
  raise exception 'CONFLICT: The meeting history cannot be changed.' using errcode = 'P0001';
end $$;
revoke all on function private.tg_meeting_events_append_only() from public, anon, authenticated;
drop trigger if exists meeting_events_append_only on public.meeting_events;
create trigger meeting_events_append_only before update or delete on public.meeting_events
  for each row execute function private.tg_meeting_events_append_only();

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.mtg_me()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account to use meetings.' using errcode = '42501';
  end if;
  return me;
end $$;

create or replace function private.mtg_is_ceo(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_profile and p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE')
$$;

create or replace function private.mtg_is_delegate(p_host uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meeting_delegates d where d.host_id = p_host and d.delegate_id = p_profile)
$$;

-- who may see a meeting: its host, whoever booked it, a colleague invited to it, the host's delegates, a Super Admin
create or replace function private.mtg_can_view(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (
    m.host_id = p_profile or m.created_by = p_profile
    or exists (select 1 from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id = p_profile)
    or private.mtg_is_delegate(m.host_id, p_profile)
    or exists (select 1 from public.profiles p where p.id = p_profile and p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'))
$$;

-- who may change it (reschedule, cancel, mark done): the host, whoever booked it, the host's delegates, a Super Admin
create or replace function private.mtg_can_manage(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (
    m.host_id = p_profile or m.created_by = p_profile or private.mtg_is_delegate(m.host_id, p_profile)
    or exists (select 1 from public.profiles p where p.id = p_profile and p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'))
$$;

-- who decides a request for the host's time: the host, the host's delegates (and a Super Admin for another Super Admin)
create or replace function private.mtg_can_decide(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (m.host_id = p_profile or private.mtg_is_delegate(m.host_id, p_profile)
    or exists (select 1 from public.profiles p where p.id = p_profile and p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'))
$$;

create or replace function private.mtg_event(p_meeting uuid, p_kind text, p_note text default null, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.meeting_events (meeting_id, actor_id, kind, note, data) values (p_meeting, auth.uid(), p_kind, p_note, coalesce(p_data, '{}'::jsonb))
$$;

create or replace function private.mtg_kind_label(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'APPOINTMENT' then 'Appointment' when 'DEMO' then 'Demo' when 'MEETING' then 'Meeting' when 'INTERVIEW' then 'Interview'
    when 'CEO_MEETING' then 'Meeting with the CEO' when 'HR_MEETING' then 'HR meeting' else 'Meeting' end
$$;

-- "Tue 18 Nov, 11:30 (Asia/Kolkata)"
create or replace function private.mtg_when(p_at timestamptz, p_tz text)
returns text language sql stable set search_path = '' as $$
  select to_char(p_at at time zone coalesce(nullif(p_tz, ''), 'Asia/Kolkata'), 'Dy DD Mon YYYY, HH24:MI') || ' (' || coalesce(nullif(p_tz, ''), 'Asia/Kolkata') || ')'
$$;

-- the colleagues taking part (host, whoever booked it, invited colleagues): for in-app notifications
create or replace function private.mtg_staff_ids(m public.meetings)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select m.host_id as x
    union select m.created_by where m.created_by is not null
    union select a.profile_id from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id is not null) s
   where x is not null
$$;

create or replace function private.mtg_notify_staff(m public.meetings, p_type text, p_title text, p_body text, p_except uuid default null,
  p_priority text default 'normal')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v uuid;
begin
  foreach v in array private.mtg_staff_ids(m) loop
    if v is distinct from p_except then
      perform private.notify_once(v, p_type, p_title, p_body, 'meeting', m.id, jsonb_build_object('meetingId', m.id, 'startsAt', m.starts_at), p_priority);
    end if;
  end loop;
end $$;

-- the host and their delegates: a request waiting for a decision
create or replace function private.mtg_notify_deciders(m public.meetings, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  perform private.notify_once(m.host_id, 'MEETING_REQUESTED', p_title, p_body, 'meeting', m.id, jsonb_build_object('meetingId', m.id), 'urgent');
  for r in select d.delegate_id from public.meeting_delegates d join public.profiles p on p.id = d.delegate_id and p.status = 'ACTIVE'
            where d.host_id = m.host_id loop
    perform private.notify_once(r.delegate_id, 'MEETING_REQUESTED', p_title, p_body, 'meeting', m.id, jsonb_build_object('meetingId', m.id), 'urgent');
  end loop;
end $$;

-- e-mails to the people outside the company on this meeting (one per person, kind and version of the meeting)
create or replace function private.mtg_mail_externals(m public.meetings, p_kind text, p_send_after timestamptz default now())
returns void language sql security definer set search_path = '' as $$
  insert into public.meeting_mail_outbox (meeting_id, to_email, to_name, kind, meeting_version, send_after)
  select m.id, lower(a.email), a.name, p_kind, m.version, p_send_after
    from public.meeting_attendees a
   where a.meeting_id = m.id and a.profile_id is null and a.email is not null
  on conflict do nothing
$$;

-- another meeting of the host at that time (requests, proposals and scheduled meetings hold the time)
create or replace function private.mtg_host_conflict(p_host uuid, p_start timestamptz, p_end timestamptz, p_except uuid default null)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.meetings m
   where m.host_id = p_host and m.id is distinct from p_except
     and m.status in ('REQUESTED', 'PROPOSED', 'SCHEDULED')
     and tstzrange(m.starts_at, m.ends_at) && tstzrange(p_start, p_end)
   limit 1
$$;

create or replace function private.mtg_lock_host(p_host uuid)
returns void language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('meeting-host:' || p_host::text, 0))
$$;

create or replace function private.mtg_json(m public.meetings, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'reference', m.reference, 'kind', m.kind, 'kindLabel', private.mtg_kind_label(m.kind), 'title', m.title,
    'description', m.description, 'hostId', m.host_id, 'hostName', h.full_name, 'hostEmail', h.email,
    'createdBy', m.created_by, 'createdByName', c.full_name,
    'startsAt', m.starts_at, 'endsAt', m.ends_at, 'timezone', m.timezone, 'mode', m.mode, 'location', m.location, 'meetLink', m.meet_link,
    'status', m.status, 'requiresApproval', m.requires_approval, 'decidedBy', m.decided_by, 'decidedByName', dcd.full_name, 'decidedAt', m.decided_at,
    'decisionNote', m.decision_note, 'proposedStartsAt', m.proposed_starts_at, 'proposedEndsAt', m.proposed_ends_at,
    'cancelReason', m.cancel_reason, 'bookedVia', m.booked_via, 'sourceType', m.source_type, 'sourceId', m.source_id,
    'customerId', m.customer_id, 'googleSyncStatus', m.google_sync_status, 'googleSyncError', m.google_sync_error,
    'googleEventId', m.google_event_id, 'version', m.version, 'createdAt', m.created_at, 'updatedAt', m.updated_at,
    'canManage', m.source_type is null and private.mtg_can_manage(m, p_viewer),
    'canDecide', m.status = 'REQUESTED' and private.mtg_can_decide(m, p_viewer),
    'canAnswerProposal', m.status = 'PROPOSED' and (m.created_by = p_viewer or (m.created_by is null and private.mtg_can_manage(m, p_viewer))),
    'attendees', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'profileId', a.profile_id, 'name', coalesce(p.full_name, a.name),
                    'email', coalesce(p.email, a.email), 'phone', a.phone, 'role', a.role, 'response', a.response) order by a.created_at)
                    from public.meeting_attendees a left join public.profiles p on p.id = a.profile_id where a.meeting_id = m.id), '[]'::jsonb))
    from public.profiles h
    left join public.profiles c on c.id = m.created_by
    left join public.profiles dcd on dcd.id = m.decided_by
   where h.id = m.host_id
$$;

-- keep Google up to date: a change that Google should see marks the meeting for the sync worker
create or replace function private.tg_meetings_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.google_sync_status := case when exists (select 1 from public.google_calendar_connections g where g.profile_id = new.host_id and g.status = 'CONNECTED')
                                   then 'PENDING' else 'NOT_CONNECTED' end;
    new.google_sync_after := now();
    return new;
  end if;
  if (new.title, new.description, new.starts_at, new.ends_at, new.status, new.mode, new.location, new.host_id, new.timezone)
     is distinct from (old.title, old.description, old.starts_at, old.ends_at, old.status, old.mode, old.location, old.host_id, old.timezone)
     or new.version is distinct from old.version then
    new.updated_at := now();
    if new.google_sync_status is not distinct from old.google_sync_status then
      new.google_sync_status := case when exists (select 1 from public.google_calendar_connections g where g.profile_id = new.host_id and g.status = 'CONNECTED')
                                     then 'PENDING' else 'NOT_CONNECTED' end;
      new.google_sync_attempts := 0;
      new.google_sync_after := now();
      new.google_sync_error := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_meetings_touch() from public, anon, authenticated;
drop trigger if exists meetings_touch on public.meetings;
create trigger meetings_touch before insert or update on public.meetings for each row execute function private.tg_meetings_touch();

-- a change of the guest list is a change Google should see
create or replace function private.tg_meeting_attendees_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.meetings set version = version + 1 where id = new.meeting_id and status in ('SCHEDULED', 'REQUESTED', 'PROPOSED');
  return new;
end $$;
revoke all on function private.tg_meeting_attendees_touch() from public, anon, authenticated;
drop trigger if exists meeting_attendees_touch on public.meeting_attendees;
create trigger meeting_attendees_touch after insert on public.meeting_attendees
  for each row execute function private.tg_meeting_attendees_touch();

-- ---------------------------------------------------------------------------
-- 3. Colleagues and Google status
-- ---------------------------------------------------------------------------
-- the active colleagues one can invite or ask for a meeting (the CEO marked), with whether their Google Calendar is connected
create or replace function public.mtg_directory(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.mtg_me();
  return coalesce((select jsonb_agg(x order by x ->> 'isCeo' desc, x ->> 'name') from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'role', p.role, 'position', p.position,
             'department', d.name, 'isCeo', p.role = 'SUPER_ADMIN',
             'googleConnected', exists (select 1 from public.google_calendar_connections g where g.profile_id = p.id and g.status = 'CONNECTED')) x
      from public.profiles p left join public.departments d on d.id = p.department_id
     where p.status = 'ACTIVE'
       and (v_q is null or p.full_name ilike '%' || v_q || '%' or p.email ilike '%' || v_q || '%')
     order by p.full_name
     limit 200) s), '[]'::jsonb);
end $$;

create or replace function public.mtg_google_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  g public.google_calendar_connections;
begin
  select * into g from public.google_calendar_connections where profile_id = me.id;
  return jsonb_build_object('connected', g.profile_id is not null and g.status = 'CONNECTED', 'status', coalesce(g.status, 'NOT_CONNECTED'),
    'googleEmail', g.google_email, 'connectedAt', g.connected_at, 'lastError', g.last_error);
end $$;

-- busy times of colleagues from the CRM's own meetings (no titles), for picking a time; the server adds their Google busy times
create or replace function public.mtg_busy(p_profiles uuid[], p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.mtg_me();
  if p_to <= p_from or p_to - p_from > interval '62 days' or coalesce(array_length(p_profiles, 1), 0) > 30 then
    raise exception 'VALIDATION_ERROR: Ask for at most 30 people and 62 days.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('profileId', x.pid, 'start', x.starts_at, 'end', x.ends_at) order by x.starts_at) from (
    select distinct m.host_id as pid, m.starts_at, m.ends_at from public.meetings m
     where m.host_id = any (p_profiles) and m.status in ('REQUESTED', 'PROPOSED', 'SCHEDULED') and m.starts_at < p_to and m.ends_at > p_from
    union
    select distinct a.profile_id, m.starts_at, m.ends_at from public.meeting_attendees a join public.meetings m on m.id = a.meeting_id
     where a.profile_id = any (p_profiles) and a.response <> 'DECLINED' and m.status = 'SCHEDULED' and m.starts_at < p_to and m.ends_at > p_from) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Booking a meeting (staff)
-- ---------------------------------------------------------------------------
-- p: { title, description, kind, hostId (default: me), startsAt, endsAt, timezone, mode, location, meetLink, customerId,
--      attendeeIds: [uuid], guests: [{ name, email, phone }], allowOverlap }
-- A meeting with a Super Admin who is not the one booking it (or their delegate) is a REQUEST until it is approved.
-- Booking time for another colleague as host is not possible; invite them instead.
create or replace function public.mtg_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  v_host uuid := coalesce(private.try_uuid(p ->> 'hostId'), me.id);
  v_start timestamptz;
  v_end timestamptz;
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'MEETING');
  v_mode text := coalesce(nullif(p ->> 'mode', ''), 'GOOGLE_MEET');
  v_request boolean;
  v_conflict uuid;
  m public.meetings;
  v_id uuid;
  g jsonb;
  v_n integer := 0;
begin
  begin
    v_start := (p ->> 'startsAt')::timestamptz;
    v_end := (p ->> 'endsAt')::timestamptz;
  exception when others then
    raise exception 'VALIDATION_ERROR: Give a valid start and end time.' using errcode = '22023';
  end;
  if length(btrim(coalesce(p ->> 'title', ''))) not between 2 and 200 then
    raise exception 'VALIDATION_ERROR: Give the meeting a title (2-200 characters).' using errcode = '22023';
  end if;
  if v_mode not in ('GOOGLE_MEET', 'ONLINE_LINK', 'IN_PERSON', 'PHONE') then
    raise exception 'VALIDATION_ERROR: Unknown meeting mode.' using errcode = '22023';
  end if;
  if v_mode = 'ONLINE_LINK' and coalesce(p ->> 'meetLink', '') !~* '^https://[^\s]+$' then
    raise exception 'VALIDATION_ERROR: Give the meeting link (https://...).' using errcode = '22023';
  end if;
  if v_start is null or v_end is null or v_end <= v_start then
    raise exception 'VALIDATION_ERROR: The meeting must end after it starts.' using errcode = '22023';
  end if;
  if v_end - v_start > interval '12 hours' then
    raise exception 'VALIDATION_ERROR: A meeting can last at most 12 hours.' using errcode = '22023';
  end if;
  if v_start < now() - interval '5 minutes' then
    raise exception 'VALIDATION_ERROR: Pick a time in the future.' using errcode = '22023';
  end if;
  if v_kind not in ('APPOINTMENT', 'DEMO', 'MEETING', 'INTERVIEW', 'CEO_MEETING') then
    raise exception 'VALIDATION_ERROR: Unknown meeting type.' using errcode = '22023';
  end if;
  if v_host <> me.id then
    if not private.mtg_is_ceo(v_host) then
      raise exception 'VALIDATION_ERROR: You can only ask the CEO for their time. Invite other colleagues to your own meeting instead.' using errcode = '22023';
    end if;
  end if;
  if private.mtg_is_ceo(v_host) and v_kind <> 'CEO_MEETING' and v_host <> me.id then
    v_kind := 'CEO_MEETING';
  end if;
  if v_kind = 'CEO_MEETING' and not private.mtg_is_ceo(v_host) then
    raise exception 'VALIDATION_ERROR: Choose the CEO for a meeting with the CEO.' using errcode = '22023';
  end if;
  -- the CEO's time is asked for, not taken (unless the CEO or their delegate books it)
  v_request := private.mtg_is_ceo(v_host) and v_host <> me.id and not private.mtg_is_delegate(v_host, me.id);

  perform private.mtg_lock_host(v_host);
  v_conflict := private.mtg_host_conflict(v_host, v_start, v_end);
  if v_conflict is not null and (v_request or v_host <> me.id or not coalesce((p ->> 'allowOverlap')::boolean, false)) then
    raise exception 'CONFLICT: % a meeting at that time. Pick another time.',
      case when v_host = me.id then 'You already have' else (select full_name from public.profiles where id = v_host) || ' already has' end using errcode = 'P0001';
  end if;

  insert into public.meetings (kind, title, description, host_id, created_by, starts_at, ends_at, timezone, mode, location, meet_link,
                               status, requires_approval, booked_via, customer_id)
  values (v_kind, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_host, me.id, v_start, v_end,
          coalesce(nullif(p ->> 'timezone', ''), (select timezone from public.meeting_host_settings where host_id = v_host), 'Asia/Kolkata'),
          v_mode, nullif(btrim(coalesce(p ->> 'location', '')), ''),
          case when v_mode = 'ONLINE_LINK' then nullif(btrim(coalesce(p ->> 'meetLink', '')), '') end,
          case when v_request then 'REQUESTED' else 'SCHEDULED' end, v_request, 'STAFF',
          private.try_uuid(p ->> 'customerId'))
  returning id into v_id;

  -- the one booking a CEO meeting takes part in it
  if v_host <> me.id then
    insert into public.meeting_attendees (meeting_id, profile_id, role, response) values (v_id, me.id, 'REQUIRED', 'ACCEPTED') on conflict do nothing;
  end if;
  insert into public.meeting_attendees (meeting_id, profile_id, role)
  select v_id, p2.id, 'REQUIRED' from public.profiles p2
   where p2.id in (select private.try_uuid(x) from jsonb_array_elements_text(coalesce(p -> 'attendeeIds', '[]'::jsonb)) x)
     and p2.status = 'ACTIVE' and p2.id <> v_host
  on conflict do nothing;
  for g in select * from jsonb_array_elements(coalesce(p -> 'guests', '[]'::jsonb)) loop
    v_n := v_n + 1;
    if v_n > 30 then
      raise exception 'VALIDATION_ERROR: Invite at most 30 guests.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(g ->> 'email', '')), '') is null then
      raise exception 'VALIDATION_ERROR: Every guest needs an e-mail address.' using errcode = '22023';
    end if;
    insert into public.meeting_attendees (meeting_id, email, name, phone, role)
    values (v_id, lower(btrim(g ->> 'email')), nullif(btrim(coalesce(g ->> 'name', '')), ''), nullif(btrim(coalesce(g ->> 'phone', '')), ''), 'EXTERNAL')
    on conflict do nothing;
  end loop;

  select * into m from public.meetings where id = v_id;
  perform private.mtg_event(m.id, case when v_request then 'REQUESTED' else 'SCHEDULED' end, null,
    jsonb_build_object('startsAt', m.starts_at, 'endsAt', m.ends_at, 'overlapAllowed', v_conflict is not null));
  if v_request then
    perform private.mtg_notify_deciders(m, 'Meeting request from ' || me.full_name,
      m.title || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '. Approve, propose another time or decline.');
  else
    perform private.mtg_notify_staff(m, 'MEETING_INVITED', 'New ' || lower(private.mtg_kind_label(m.kind)) || ': ' || m.title,
      'By ' || me.full_name || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '.', me.id);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  end if;
  perform private.write_audit('MEETING_' || case when v_request then 'REQUESTED' else 'SCHEDULED' end, 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('kind', m.kind, 'host', m.host_id, 'startsAt', m.starts_at));
  return private.mtg_json(m, me.id);
end $$;

-- my meetings (and, for the CEO's delegates, the CEO's) between two times
create or replace function public.mtg_list(p_from timestamptz, p_to timestamptz, p_host uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'VALIDATION_ERROR: Ask for at most 400 days.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(private.mtg_json(m, me.id) order by m.starts_at) from public.meetings m
     where m.starts_at < p_to and m.ends_at > p_from
       and (p_host is null or m.host_id = p_host)
       and (m.host_id = me.id or m.created_by = me.id
            or exists (select 1 from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id = me.id)
            or private.mtg_is_delegate(m.host_id, me.id)
            or (p_host is not null and me.role = 'SUPER_ADMIN'))), '[]'::jsonb);
end $$;

create or replace function public.mtg_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
begin
  select * into m from public.meetings where id = p_id;
  if m.id is null or not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  return private.mtg_json(m, me.id) || jsonb_build_object('history',
    coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'note', e.note, 'actorName', p.full_name, 'at', e.created_at, 'data', e.data) order by e.id)
                from public.meeting_events e left join public.profiles p on p.id = e.actor_id where e.meeting_id = m.id), '[]'::jsonb));
end $$;

-- requests waiting for my decision (I am the host or their delegate)
create or replace function public.mtg_pending_approvals()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  return coalesce((select jsonb_agg(private.mtg_json(m, me.id) order by m.starts_at) from public.meetings m
     where m.status = 'REQUESTED' and (m.host_id = me.id or private.mtg_is_delegate(m.host_id, me.id))), '[]'::jsonb);
end $$;

create or replace function private.mtg_for_update(p_id uuid, p_version integer)
returns public.meetings language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_id for update;
  if m.id is null then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if p_version is not null and m.version <> p_version then
    raise exception 'CONFLICT: This meeting was changed by someone else. Reload it and try again.' using errcode = 'P0001';
  end if;
  return m;
end $$;

-- approve / decline / propose another time (the CEO or their delegate)
create or replace function public.mtg_decide(p_id uuid, p_decision text, p_note text default null, p_starts_at timestamptz default null,
  p_ends_at timestamptz default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mtg_for_update(p_id, p_version);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if not private.mtg_can_decide(m, me.id) then
    raise exception 'FORBIDDEN: Only the person asked for the meeting (or their delegate) can decide.' using errcode = '42501';
  end if;
  if m.status <> 'REQUESTED' then
    raise exception 'CONFLICT: This request was already answered.' using errcode = 'P0001';
  end if;
  perform private.mtg_lock_host(m.host_id);
  if p_decision = 'APPROVE' then
    if private.mtg_host_conflict(m.host_id, m.starts_at, m.ends_at, m.id) is not null
       and exists (select 1 from public.meetings x where x.id = private.mtg_host_conflict(m.host_id, m.starts_at, m.ends_at, m.id) and x.status = 'SCHEDULED') then
      raise exception 'CONFLICT: Another meeting is already scheduled at that time. Propose another time instead.' using errcode = 'P0001';
    end if;
    update public.meetings set status = 'SCHEDULED', decided_by = me.id, decided_at = now(), decision_note = v_note, version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'APPROVED', v_note);
    perform private.mtg_notify_staff(m, 'MEETING_APPROVED', 'Meeting approved: ' || m.title,
      private.mtg_when(m.starts_at, m.timezone) || coalesce('. ' || v_note, '') || '.', me.id);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  elsif p_decision = 'DECLINE' then
    update public.meetings set status = 'DECLINED', decided_by = me.id, decided_at = now(), decision_note = v_note, version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'DECLINED', v_note);
    perform private.mtg_notify_staff(m, 'MEETING_DECLINED', 'Meeting request declined: ' || m.title, coalesce(v_note, 'No reason given.'), me.id);
    perform private.mtg_mail_externals(m, 'DECLINED');
  elsif p_decision = 'PROPOSE' then
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_starts_at < now() then
      raise exception 'VALIDATION_ERROR: Propose a future time that ends after it starts.' using errcode = '22023';
    end if;
    if private.mtg_host_conflict(m.host_id, p_starts_at, p_ends_at, m.id) is not null then
      raise exception 'CONFLICT: That time is taken too. Propose another one.' using errcode = 'P0001';
    end if;
    update public.meetings set status = 'PROPOSED', decided_by = me.id, decided_at = now(), decision_note = v_note,
           proposed_starts_at = p_starts_at, proposed_ends_at = p_ends_at, version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'PROPOSED', v_note, jsonb_build_object('startsAt', p_starts_at, 'endsAt', p_ends_at));
    perform private.mtg_notify_staff(m, 'MEETING_PROPOSED', 'Another time proposed: ' || m.title,
      private.mtg_when(p_starts_at, m.timezone) || '. Accept it or decline.', me.id, 'urgent');
    perform private.mtg_mail_externals(m, 'PROPOSED');
  else
    raise exception 'VALIDATION_ERROR: Decide APPROVE, DECLINE or PROPOSE.' using errcode = '22023';
  end if;
  perform private.write_audit('MEETING_' || p_decision || 'D', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('host', m.host_id, 'note', v_note));
  return private.mtg_json(m, me.id);
end $$;

-- the one who asked answers a proposed time
create or replace function private.mtg_answer_proposal(m public.meetings, p_accept boolean, p_actor uuid)
returns public.meetings language plpgsql security definer set search_path = '' as $$
begin
  if m.status <> 'PROPOSED' then
    raise exception 'CONFLICT: There is no proposed time to answer.' using errcode = 'P0001';
  end if;
  perform private.mtg_lock_host(m.host_id);
  if p_accept then
    if private.mtg_host_conflict(m.host_id, m.proposed_starts_at, m.proposed_ends_at, m.id) is not null then
      raise exception 'CONFLICT: The proposed time is no longer free. Ask for another time.' using errcode = 'P0001';
    end if;
    update public.meetings set status = 'SCHEDULED', starts_at = proposed_starts_at, ends_at = proposed_ends_at,
           proposed_starts_at = null, proposed_ends_at = null, version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'PROPOSAL_ACCEPTED');
    perform private.mtg_notify_staff(m, 'MEETING_APPROVED', 'Meeting confirmed: ' || m.title, private.mtg_when(m.starts_at, m.timezone) || '.', p_actor);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  else
    update public.meetings set status = 'DECLINED', version = version + 1 where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'PROPOSAL_DECLINED');
    perform private.mtg_notify_staff(m, 'MEETING_DECLINED', 'Proposed time declined: ' || m.title, 'The request is closed.', p_actor);
  end if;
  return m;
end $$;

create or replace function public.mtg_answer_proposal(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mtg_for_update(p_id, null);
begin
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if m.created_by is distinct from me.id then
    raise exception 'FORBIDDEN: Only the person who asked for the meeting can answer the proposed time.' using errcode = '42501';
  end if;
  m := private.mtg_answer_proposal(m, p_accept, me.id);
  return private.mtg_json(m, me.id);
end $$;

-- move a meeting (the CEO's time again needs approval when the one asking moves it)
create or replace function public.mtg_reschedule(p_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_note text default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mtg_for_update(p_id, p_version);
  v_old timestamptz := m.starts_at;
  v_request boolean;
begin
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if m.source_type is not null then
    raise exception 'CONFLICT: This meeting is managed in its own page (demo, interview or HR meeting). Change it there.' using errcode = 'P0001';
  end if;
  if not private.mtg_can_manage(m, me.id) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can move it.' using errcode = '42501';
  end if;
  if m.status not in ('REQUESTED', 'PROPOSED', 'SCHEDULED') then
    raise exception 'CONFLICT: A % meeting cannot be moved.', lower(m.status) using errcode = 'P0001';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_starts_at < now() - interval '5 minutes' then
    raise exception 'VALIDATION_ERROR: Pick a future time that ends after it starts.' using errcode = '22023';
  end if;
  perform private.mtg_lock_host(m.host_id);
  if private.mtg_host_conflict(m.host_id, p_starts_at, p_ends_at, m.id) is not null then
    raise exception 'CONFLICT: The host already has a meeting at that time. Pick another time.' using errcode = 'P0001';
  end if;
  v_request := m.requires_approval and not private.mtg_can_decide(m, me.id);
  update public.meetings set starts_at = p_starts_at, ends_at = p_ends_at, proposed_starts_at = null, proposed_ends_at = null,
         status = case when v_request then 'REQUESTED' else 'SCHEDULED' end, version = version + 1
   where id = m.id returning * into m;
  perform private.mtg_event(m.id, 'RESCHEDULED', nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('from', v_old, 'to', p_starts_at));
  if v_request then
    perform private.mtg_notify_deciders(m, 'Meeting request moved by ' || me.full_name, m.title || ' — now ' || private.mtg_when(m.starts_at, m.timezone) || '.');
  else
    perform private.mtg_notify_staff(m, 'MEETING_RESCHEDULED', 'Meeting moved: ' || m.title,
      'Now ' || private.mtg_when(m.starts_at, m.timezone) || ' (was ' || private.mtg_when(v_old, m.timezone) || ').', me.id);
    perform private.mtg_mail_externals(m, 'RESCHEDULED');
  end if;
  perform private.write_audit('MEETING_RESCHEDULED', 'meeting', m.id, me.department_id, me.team_id, jsonb_build_object('from', v_old, 'to', p_starts_at));
  return private.mtg_json(m, me.id);
end $$;

create or replace function public.mtg_cancel(p_id uuid, p_reason text default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mtg_for_update(p_id, p_version);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_was text := m.status;
begin
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if m.source_type is not null then
    raise exception 'CONFLICT: This meeting is managed in its own page (demo, interview or HR meeting). Cancel it there.' using errcode = 'P0001';
  end if;
  if not private.mtg_can_manage(m, me.id) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can cancel it.' using errcode = '42501';
  end if;
  if m.status not in ('REQUESTED', 'PROPOSED', 'SCHEDULED') then
    raise exception 'CONFLICT: This meeting is already %.', lower(m.status) using errcode = 'P0001';
  end if;
  update public.meetings set status = 'CANCELLED', cancel_reason = v_reason, cancelled_by = me.id, version = version + 1
   where id = m.id returning * into m;
  perform private.mtg_event(m.id, 'CANCELLED', v_reason);
  perform private.mtg_notify_staff(m, 'MEETING_CANCELLED', 'Meeting cancelled: ' || m.title,
    private.mtg_when(m.starts_at, m.timezone) || coalesce('. Reason: ' || v_reason, '') || '.', me.id);
  if v_was <> 'REQUESTED' or m.booked_via = 'BOOKING_LINK' then
    perform private.mtg_mail_externals(m, 'CANCELLED');
  end if;
  perform private.write_audit('MEETING_CANCELLED', 'meeting', m.id, me.department_id, me.team_id, jsonb_build_object('reason', v_reason));
  return private.mtg_json(m, me.id);
end $$;

create or replace function public.mtg_complete(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mtg_for_update(p_id, null);
begin
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if m.source_type is not null or not private.mtg_can_manage(m, me.id) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can mark it done.' using errcode = '42501';
  end if;
  if m.status <> 'SCHEDULED' or m.starts_at > now() then
    raise exception 'CONFLICT: Only a scheduled meeting that has started can be marked done.' using errcode = 'P0001';
  end if;
  update public.meetings set status = 'COMPLETED', google_sync_status = 'SKIPPED' where id = m.id returning * into m;
  perform private.mtg_event(m.id, 'COMPLETED', nullif(btrim(coalesce(p_note, '')), ''));
  return private.mtg_json(m, me.id);
end $$;

-- an invited colleague answers
create or replace function public.mtg_respond(p_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
begin
  if p_response not in ('ACCEPTED', 'DECLINED', 'TENTATIVE') then
    raise exception 'VALIDATION_ERROR: Answer ACCEPTED, DECLINED or TENTATIVE.' using errcode = '22023';
  end if;
  select * into m from public.meetings where id = p_id;
  update public.meeting_attendees set response = p_response where meeting_id = p_id and profile_id = me.id;
  if not found or m.id is null then
    raise exception 'NOT_FOUND: You are not invited to this meeting.' using errcode = 'P0002';
  end if;
  perform private.mtg_event(m.id, 'RESPONSE_' || p_response);
  if p_response = 'DECLINED' then
    perform private.notify_once(m.host_id, 'MEETING_RESPONSE', me.full_name || ' cannot attend: ' || m.title,
      private.mtg_when(m.starts_at, m.timezone) || '.', 'meeting', m.id, jsonb_build_object('meetingId', m.id));
  end if;
  return private.mtg_json(m, me.id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Booking links, working hours, delegates
-- ---------------------------------------------------------------------------
create or replace function private.mtg_booking_type_json(t public.meeting_booking_types)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'hostId', t.host_id, 'slug', t.slug, 'title', t.title, 'description', t.description, 'kind', t.kind,
    'durationMinutes', t.duration_minutes, 'bufferMinutes', t.buffer_minutes, 'minNoticeMinutes', t.min_notice_minutes,
    'maxDaysAhead', t.max_days_ahead, 'mode', t.mode, 'location', t.location, 'requiresApproval', t.requires_approval,
    'isActive', t.is_active, 'createdAt', t.created_at)
$$;

create or replace function private.mtg_settings_json(p_host uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'timezone', coalesce((select s.timezone from public.meeting_host_settings s where s.host_id = p_host), 'Asia/Kolkata'),
    'availability', coalesce((select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'), 'end', to_char(a.end_time, 'HH24:MI'))
                                order by a.weekday, a.start_time) from public.meeting_availability a where a.host_id = p_host), '[]'::jsonb),
    'availabilityIsDefault', not exists (select 1 from public.meeting_availability a where a.host_id = p_host),
    'delegates', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email) order by p.full_name)
                             from public.meeting_delegates d join public.profiles p on p.id = d.delegate_id where d.host_id = p_host), '[]'::jsonb),
    'bookingTypes', coalesce((select jsonb_agg(private.mtg_booking_type_json(t) order by t.created_at) from public.meeting_booking_types t where t.host_id = p_host), '[]'::jsonb),
    'isCeo', private.mtg_is_ceo(p_host))
$$;

create or replace function public.mtg_my_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  return private.mtg_settings_json(me.id);
end $$;

-- p: { timezone, availability: [{ weekday, start: 'HH:MM', end: 'HH:MM' }] } — replaces the weekly hours
create or replace function public.mtg_set_availability(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  w jsonb;
  v_tz text := coalesce(nullif(btrim(p ->> 'timezone'), ''), 'Asia/Kolkata');
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception 'VALIDATION_ERROR: Unknown time zone.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p -> 'availability', '[]'::jsonb)) > 50 then
    raise exception 'VALIDATION_ERROR: Give at most 50 time windows.' using errcode = '22023';
  end if;
  insert into public.meeting_host_settings (host_id, timezone, updated_at) values (me.id, v_tz, now())
  on conflict (host_id) do update set timezone = excluded.timezone, updated_at = now();
  delete from public.meeting_availability where host_id = me.id;
  for w in select * from jsonb_array_elements(coalesce(p -> 'availability', '[]'::jsonb)) loop
    begin
      insert into public.meeting_availability (host_id, weekday, start_time, end_time)
      values (me.id, (w ->> 'weekday')::smallint, (w ->> 'start')::time, (w ->> 'end')::time);
    exception when check_violation or invalid_datetime_format or invalid_text_representation or datetime_field_overflow then
      raise exception 'VALIDATION_ERROR: Each window needs a weekday (0-6) and a start before its end (HH:MM).' using errcode = '22023';
    end;
  end loop;
  perform private.write_audit('MEETING_AVAILABILITY_SET', 'profile', me.id, me.department_id, me.team_id,
    jsonb_build_object('timezone', v_tz, 'windows', jsonb_array_length(coalesce(p -> 'availability', '[]'::jsonb))));
  return private.mtg_settings_json(me.id);
end $$;

-- p: { id?, slug, title, description, kind, durationMinutes, bufferMinutes, minNoticeMinutes, maxDaysAhead, mode, location, requiresApproval, isActive }
create or replace function public.mtg_booking_type_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  v_id uuid := private.try_uuid(p ->> 'id');
  v_kind text := coalesce(nullif(p ->> 'kind', ''), case when me.role = 'SUPER_ADMIN' then 'CEO_MEETING' else 'APPOINTMENT' end);
  t public.meeting_booking_types;
begin
  if v_kind = 'CEO_MEETING' and me.role <> 'SUPER_ADMIN' then
    raise exception 'VALIDATION_ERROR: Only the CEO has a "meeting with the CEO" link.' using errcode = '22023';
  end if;
  begin
    if v_id is null then
      insert into public.meeting_booking_types (host_id, slug, title, description, kind, duration_minutes, buffer_minutes, min_notice_minutes,
                                                max_days_ahead, mode, location, requires_approval, is_active)
      values (me.id, lower(btrim(p ->> 'slug')), btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_kind,
              coalesce((p ->> 'durationMinutes')::integer, 30), coalesce((p ->> 'bufferMinutes')::integer, 0),
              coalesce((p ->> 'minNoticeMinutes')::integer, 120), coalesce((p ->> 'maxDaysAhead')::integer, 30),
              coalesce(nullif(p ->> 'mode', ''), 'GOOGLE_MEET'), nullif(btrim(coalesce(p ->> 'location', '')), ''),
              -- the CEO's time is always approved first
              coalesce((p ->> 'requiresApproval')::boolean, false) or me.role = 'SUPER_ADMIN', coalesce((p ->> 'isActive')::boolean, true))
      returning * into t;
    else
      update public.meeting_booking_types set
        slug = lower(btrim(p ->> 'slug')), title = btrim(p ->> 'title'), description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
        kind = v_kind, duration_minutes = coalesce((p ->> 'durationMinutes')::integer, duration_minutes),
        buffer_minutes = coalesce((p ->> 'bufferMinutes')::integer, buffer_minutes),
        min_notice_minutes = coalesce((p ->> 'minNoticeMinutes')::integer, min_notice_minutes),
        max_days_ahead = coalesce((p ->> 'maxDaysAhead')::integer, max_days_ahead), mode = coalesce(nullif(p ->> 'mode', ''), mode),
        location = nullif(btrim(coalesce(p ->> 'location', '')), ''),
        requires_approval = coalesce((p ->> 'requiresApproval')::boolean, requires_approval) or me.role = 'SUPER_ADMIN',
        is_active = coalesce((p ->> 'isActive')::boolean, is_active), updated_at = now()
       where id = v_id and host_id = me.id
      returning * into t;
      if t.id is null then
        raise exception 'NOT_FOUND: Booking link not found.' using errcode = 'P0002';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'CONFLICT: That link name is taken. Choose another one.' using errcode = 'P0001';
    when check_violation or invalid_text_representation or not_null_violation then
      raise exception 'VALIDATION_ERROR: Check the link: a name of 4-64 lowercase letters, digits or dashes, a title, and durations in range.' using errcode = '22023';
  end;
  perform private.write_audit('MEETING_BOOKING_LINK_SAVED', 'meeting_booking_type', t.id, me.department_id, me.team_id,
    jsonb_build_object('slug', t.slug, 'active', t.is_active));
  return private.mtg_booking_type_json(t);
end $$;

-- the CEO (any host) names who may approve their meeting requests and see their meetings
create or replace function public.mtg_set_delegates(p_delegates uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  if coalesce(array_length(p_delegates, 1), 0) > 10 then
    raise exception 'VALIDATION_ERROR: Name at most 10 delegates.' using errcode = '22023';
  end if;
  delete from public.meeting_delegates where host_id = me.id and not (delegate_id = any (coalesce(p_delegates, '{}')));
  insert into public.meeting_delegates (host_id, delegate_id)
  select me.id, p.id from public.profiles p where p.id = any (coalesce(p_delegates, '{}')) and p.status = 'ACTIVE' and p.id <> me.id
  on conflict do nothing;
  perform private.write_audit('MEETING_DELEGATES_SET', 'profile', me.id, me.department_id, me.team_id, jsonb_build_object('delegates', to_jsonb(p_delegates)));
  return private.mtg_settings_json(me.id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Public booking (the server calls these with the service role after its own checks; never granted to anon)
-- ---------------------------------------------------------------------------
-- the booking page: what the link offers and when the host is already taken in the CRM (the server adds Google busy times and builds the slots)
create or replace function public.mtg_public_page(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.meeting_booking_types;
  h public.profiles;
begin
  select * into t from public.meeting_booking_types where slug = lower(btrim(p_slug)) and is_active;
  select * into h from public.profiles where id = t.host_id and status = 'ACTIVE';
  if t.id is null or h.id is null then
    raise exception 'NOT_FOUND: This booking link does not exist or is switched off.' using errcode = 'P0002';
  end if;
  return private.mtg_booking_type_json(t) || jsonb_build_object(
    'hostName', h.full_name, 'hostPosition', coalesce(nullif(btrim(h.position), ''), case when h.role = 'SUPER_ADMIN' then 'CEO' end),
    'requiresApproval', t.requires_approval or h.role = 'SUPER_ADMIN',
    'settings', private.mtg_settings_json(h.id) - 'delegates' - 'bookingTypes',
    'busy', coalesce((select jsonb_agg(jsonb_build_object('start', m.starts_at, 'end', m.ends_at) order by m.starts_at) from public.meetings m
                       where m.host_id = h.id and m.status in ('REQUESTED', 'PROPOSED', 'SCHEDULED')
                         and m.ends_at > now() and m.starts_at < now() + make_interval(days => t.max_days_ahead + 1)), '[]'::jsonb));
end $$;

-- book a slot through a link. p: { slug, startsAt, name, email, phone, notes }. The server has checked the slot against Google already.
create or replace function public.mtg_public_book(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.meeting_booking_types;
  h public.profiles;
  v_start timestamptz;
  v_end timestamptz;
  v_tz text;
  v_local timestamp;
  v_request boolean;
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name text := btrim(coalesce(p ->> 'name', ''));
  m public.meetings;
  v_id uuid;
begin
  select * into t from public.meeting_booking_types where slug = lower(btrim(p ->> 'slug')) and is_active;
  select * into h from public.profiles where id = t.host_id and status = 'ACTIVE';
  if t.id is null or h.id is null then
    raise exception 'NOT_FOUND: This booking link does not exist or is switched off.' using errcode = 'P0002';
  end if;
  if length(v_name) not between 2 and 200 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 320 then
    raise exception 'VALIDATION_ERROR: Give your name and a valid e-mail address.' using errcode = '22023';
  end if;
  begin
    v_start := (p ->> 'startsAt')::timestamptz;
  exception when others then
    raise exception 'VALIDATION_ERROR: Pick a time.' using errcode = '22023';
  end;
  v_end := v_start + make_interval(mins => t.duration_minutes);
  if v_start < now() + make_interval(mins => t.min_notice_minutes) or v_start > now() + make_interval(days => t.max_days_ahead) then
    raise exception 'VALIDATION_ERROR: This time can no longer be booked. Pick another one.' using errcode = '22023';
  end if;
  -- inside the host's working hours (their own time zone)
  v_tz := coalesce((select s.timezone from public.meeting_host_settings s where s.host_id = h.id), 'Asia/Kolkata');
  v_local := v_start at time zone v_tz;
  if not (
    (exists (select 1 from public.meeting_availability a where a.host_id = h.id
              and a.weekday = extract(dow from v_local) and a.start_time <= v_local::time
              and a.end_time >= (v_end at time zone v_tz)::time and (v_end at time zone v_tz)::date = v_local::date))
    or (not exists (select 1 from public.meeting_availability a where a.host_id = h.id)
        and extract(dow from v_local) between 1 and 6 and v_local::time >= time '10:00' and (v_end at time zone v_tz)::time <= time '18:00'
        and (v_end at time zone v_tz)::date = v_local::date)) then
    raise exception 'VALIDATION_ERROR: This time is outside the working hours. Pick another one.' using errcode = '22023';
  end if;
  perform private.mtg_lock_host(h.id);
  if exists (select 1 from public.meetings x where x.host_id = h.id and x.status in ('REQUESTED', 'PROPOSED', 'SCHEDULED')
              and tstzrange(x.starts_at - make_interval(mins => t.buffer_minutes), x.ends_at + make_interval(mins => t.buffer_minutes))
                  && tstzrange(v_start, v_end)) then
    raise exception 'CONFLICT: Someone just booked this time. Pick another one.' using errcode = 'P0001';
  end if;
  -- one person cannot hold many slots of the same link
  if (select count(*) from public.meetings x join public.meeting_attendees a on a.meeting_id = x.id and a.profile_id is null and lower(a.email) = v_email
       where x.booking_type_id = t.id and x.status in ('REQUESTED', 'PROPOSED', 'SCHEDULED') and x.ends_at > now()) >= 3 then
    raise exception 'CONFLICT: You already have bookings waiting with this link. Use the link in your e-mail to change one.' using errcode = 'P0001';
  end if;
  v_request := t.requires_approval or h.role = 'SUPER_ADMIN';
  insert into public.meetings (kind, title, description, host_id, created_by, starts_at, ends_at, timezone, mode, location, status,
                               requires_approval, booking_type_id, booked_via)
  values (t.kind, t.title || ' — ' || v_name, nullif(btrim(coalesce(p ->> 'notes', '')), ''), h.id, null, v_start, v_end, v_tz, t.mode, t.location,
          case when v_request then 'REQUESTED' else 'SCHEDULED' end, v_request, t.id, 'BOOKING_LINK')
  returning id into v_id;
  insert into public.meeting_attendees (meeting_id, email, name, phone, role, response)
  values (v_id, v_email, left(v_name, 200), nullif(left(btrim(coalesce(p ->> 'phone', '')), 40), ''), 'EXTERNAL', 'ACCEPTED');
  select * into m from public.meetings where id = v_id;
  insert into public.meeting_events (meeting_id, actor_id, kind, data)
  values (m.id, null, case when v_request then 'REQUESTED' else 'BOOKED' end, jsonb_build_object('via', 'BOOKING_LINK', 'slug', t.slug, 'name', v_name));
  if v_request then
    perform private.mtg_notify_deciders(m, 'Meeting request from ' || v_name, t.title || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '.');
    perform private.mtg_mail_externals(m, 'REQUEST_RECEIVED');
  else
    perform private.notify(h.id, 'MEETING_BOOKED', v_name || ' booked ' || t.title, private.mtg_when(m.starts_at, m.timezone) || '.', 'meeting', m.id,
      jsonb_build_object('meetingId', m.id), 'normal');
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  end if;
  return private.mtg_json(m, null);
end $$;

-- the guest's own booking, opened from the link in their e-mail (the server checked the signed link)
create or replace function public.mtg_public_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_id and booked_via = 'BOOKING_LINK';
  if m.id is null then
    raise exception 'NOT_FOUND: Booking not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', m.id, 'reference', m.reference, 'title', m.title, 'startsAt', m.starts_at, 'endsAt', m.ends_at,
    'timezone', m.timezone, 'mode', m.mode, 'location', m.location, 'meetLink', m.meet_link, 'status', m.status,
    'proposedStartsAt', m.proposed_starts_at, 'proposedEndsAt', m.proposed_ends_at, 'decisionNote', m.decision_note,
    'hostName', (select full_name from public.profiles where id = m.host_id),
    'slug', (select slug from public.meeting_booking_types where id = m.booking_type_id));
end $$;

create or replace function public.mtg_public_cancel(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
begin
  select * into m from public.meetings where id = p_id and booked_via = 'BOOKING_LINK' for update;
  if m.id is null then
    raise exception 'NOT_FOUND: Booking not found.' using errcode = 'P0002';
  end if;
  if m.status not in ('REQUESTED', 'PROPOSED', 'SCHEDULED') then
    raise exception 'CONFLICT: This booking is already %.', lower(m.status) using errcode = 'P0001';
  end if;
  update public.meetings set status = 'CANCELLED', cancel_reason = coalesce(v_reason, 'Cancelled by the guest'), version = version + 1
   where id = m.id returning * into m;
  insert into public.meeting_events (meeting_id, actor_id, kind, note) values (m.id, null, 'CANCELLED_BY_GUEST', v_reason);
  perform private.mtg_notify_staff(m, 'MEETING_CANCELLED', 'Booking cancelled by the guest: ' || m.title,
    private.mtg_when(m.starts_at, m.timezone) || coalesce('. Reason: ' || v_reason, '') || '.');
  perform private.mtg_mail_externals(m, 'CANCELLED');
  return public.mtg_public_get(m.id);
end $$;

create or replace function public.mtg_public_answer_proposal(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_id and booked_via = 'BOOKING_LINK' for update;
  if m.id is null then
    raise exception 'NOT_FOUND: Booking not found.' using errcode = 'P0002';
  end if;
  m := private.mtg_answer_proposal(m, p_accept, null);
  return public.mtg_public_get(m.id);
end $$;

-- ---------------------------------------------------------------------------
-- 7. The server's worker (service role): Google sync, e-mails, reminders
-- ---------------------------------------------------------------------------
-- meetings whose Google event must be created, changed or removed (a claim holds them for 2 minutes)
create or replace function public.mtg_sync_claim(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  -- a connection lost since: nothing to sync to
  update public.meetings m set google_sync_status = 'NOT_CONNECTED'
   where m.google_sync_status in ('PENDING', 'FAILED')
     and not exists (select 1 from public.google_calendar_connections g where g.profile_id = m.host_id and g.status = 'CONNECTED');
  select array_agg(id) into v_ids from (
    select m.id from public.meetings m
     where m.google_sync_status in ('PENDING', 'FAILED') and m.google_sync_after <= now() and m.google_sync_attempts < 6
     order by m.google_sync_after
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked) s;
  if v_ids is null then
    return '[]'::jsonb;
  end if;
  update public.meetings set google_sync_after = now() + interval '2 minutes', google_sync_attempts = google_sync_attempts + 1 where id = any (v_ids);
  return coalesce((select jsonb_agg(private.mtg_json(m, null) || jsonb_build_object('googleCalendarId', m.google_calendar_id)) from public.meetings m where m.id = any (v_ids)), '[]'::jsonb);
end $$;

-- the result of one sync: the event id and Meet link Google gave, or the error
drop function if exists public.mtg_sync_result(uuid, integer, boolean, text, text, text, text, boolean);
create or replace function public.mtg_sync_result(p_id uuid, p_version integer, p_ok boolean, p_event_id text default null,
  p_calendar_id text default null, p_meet_link text default null, p_error text default null, p_skipped boolean default false,
  p_event_removed boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_id for update;
  if m.id is null then
    return;
  end if;
  if p_ok then
    update public.meetings set
      google_event_id = case when p_event_removed then null else coalesce(p_event_id, google_event_id) end,
      google_calendar_id = case when p_event_removed then null else coalesce(p_calendar_id, google_calendar_id) end,
      meet_link = case when mode = 'GOOGLE_MEET' and p_meet_link ~* '^https://[^\s]+$' then p_meet_link else meet_link end,
      -- changed again while syncing: stays pending
      google_sync_status = case when version <> p_version then 'PENDING' when p_skipped then 'SKIPPED' else 'SYNCED' end,
      google_sync_after = now(), google_sync_error = null, google_synced_at = now(),
      google_sync_attempts = case when version <> p_version then 0 else google_sync_attempts end
     where id = p_id;
  else
    update public.meetings set google_sync_status = 'FAILED', google_sync_error = left(coalesce(p_error, 'Google Calendar refused the change.'), 500),
           google_sync_after = now() + make_interval(mins => least(240, 5 * (2 ^ greatest(google_sync_attempts - 1, 0))::integer))
     where id = p_id;
    if m.google_sync_attempts >= 5 then
      perform private.notify_once(m.host_id, 'MEETING_SYNC_FAILED', 'Google Calendar could not be updated: ' || m.title,
        left(coalesce(p_error, 'Google Calendar refused the change.'), 300), 'meeting', m.id, jsonb_build_object('meetingId', m.id));
    end if;
  end if;
end $$;

-- Google says the connection no longer works (revoked / expired): the person must connect again
create or replace function public.mtg_connection_broken(p_profile uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.google_calendar_connections set status = 'NEEDS_RECONNECT', last_error = left(p_error, 500), updated_at = now()
   where profile_id = p_profile and status = 'CONNECTED';
  if found then
    perform private.notify(p_profile, 'GOOGLE_CALENDAR_DISCONNECTED', 'Reconnect your Google Calendar',
      'Google stopped accepting the CRM''s access. Open Meetings and connect Google Calendar again.', 'profile', p_profile, '{}'::jsonb, 'urgent');
  end if;
end $$;

-- a new or renewed connection: everything waiting for Google is sent now
create or replace function public.mtg_connection_saved(p_profile uuid)
returns void language sql security definer set search_path = '' as $$
  update public.meetings set google_sync_status = 'PENDING', google_sync_attempts = 0, google_sync_after = now(), google_sync_error = null
   where host_id = p_profile and google_sync_status in ('NOT_CONNECTED', 'FAILED') and ends_at > now()
     and status in ('SCHEDULED', 'CANCELLED', 'DECLINED')
$$;

-- reminders 24 hours and 1 hour before: in the CRM for colleagues, by e-mail for guests. Each once (per start time).
create or replace function public.mtg_enqueue_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r public.meetings;
  k text;
  v_n integer := 0;
begin
  for r in select * from public.meetings m where m.status = 'SCHEDULED' and m.starts_at > now() and m.starts_at <= now() + interval '24 hours' loop
    k := case when r.starts_at <= now() + interval '1 hour' then '1H' else '24H' end;
    -- a meeting booked within the hour gets no "in 24 hours" reminder afterwards
    insert into public.meeting_reminders (meeting_id, kind, starts_at) values (r.id, k, r.starts_at) on conflict do nothing;
    if found then
      v_n := v_n + 1;
      perform private.mtg_notify_staff(r, 'MEETING_REMINDER',
        case k when '1H' then 'Starting soon: ' else 'Tomorrow: ' end || r.title, private.mtg_when(r.starts_at, r.timezone) ||
        coalesce('. Join: ' || r.meet_link, '') || '.');
      perform private.mtg_mail_externals(r, 'REMINDER_' || k);
    end if;
  end loop;
  return v_n;
end $$;

-- e-mails to send now (a claim holds them for 5 minutes)
create or replace function public.mtg_mail_claim(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids bigint[];
begin
  select array_agg(id) into v_ids from (
    select o.id from public.meeting_mail_outbox o
     where (o.status in ('PENDING', 'FAILED') or (o.status = 'SENDING' and o.send_after <= now())) and o.send_after <= now() and o.attempts < 5
     order by o.send_after
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked) s;
  if v_ids is null then
    return '[]'::jsonb;
  end if;
  update public.meeting_mail_outbox set status = 'SENDING', attempts = attempts + 1, send_after = now() + interval '5 minutes' where id = any (v_ids);
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'toEmail', o.to_email, 'toName', o.to_name, 'kind', o.kind,
            'meetingVersion', o.meeting_version, 'meeting', private.mtg_json(m, null)) order by o.id)
            from public.meeting_mail_outbox o join public.meetings m on m.id = o.meeting_id where o.id = any (v_ids)), '[]'::jsonb);
end $$;

-- SENT / SKIPPED (Google sent its own invitation, or sending is switched off) / FAILED (retried later) /
-- DEFER (the Google sync of the meeting is still running: look again in 2 minutes, not counted as an attempt)
create or replace function public.mtg_mail_result(p_id bigint, p_status text, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.meeting_mail_outbox set
    status = case when p_status in ('SENT', 'SKIPPED') then p_status when p_status = 'DEFER' then 'PENDING' else 'FAILED' end,
    sent_at = case when p_status = 'SENT' then now() end,
    last_error = left(p_error, 500),
    attempts = case when p_status = 'DEFER' then greatest(attempts - 1, 0) else attempts end,
    send_after = case when p_status in ('SENT', 'SKIPPED') then send_after when p_status = 'DEFER' then now() + interval '2 minutes'
                      else now() + make_interval(mins => 10 * attempts) end
   where id = p_id
$$;

-- ---------------------------------------------------------------------------
-- 8. The existing scheduling screens feed the same engine (mirrors; changed in their own pages)
-- ---------------------------------------------------------------------------
create or replace function private.mtg_mirror(p_source text, p_source_id uuid, p_kind text, p_title text, p_description text, p_host uuid,
  p_created_by uuid, p_start timestamptz, p_end timestamptz, p_mode text, p_location text, p_link text, p_status text,
  p_guest_email text, p_guest_name text, p_guest_phone text, p_staff_guest uuid default null, p_customer uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  v_title text := left(coalesce(nullif(btrim(p_title), ''), private.mtg_kind_label(p_kind)), 200);
  v_link text := case when p_link ~* '^https://[^\s]+$' and length(p_link) <= 500 then p_link end;
  v_mode text := case when v_link is not null then 'ONLINE_LINK' else p_mode end;
  v_email text := case when lower(btrim(p_guest_email)) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(btrim(p_guest_email)) end;
  v_prev public.meetings;
begin
  if p_host is null or p_start is null then
    return;
  end if;
  if length(btrim(v_title)) < 2 then
    v_title := private.mtg_kind_label(p_kind);
  end if;
  select * into v_prev from public.meetings where source_type = p_source and source_id = p_source_id;
  insert into public.meetings (kind, title, description, host_id, created_by, starts_at, ends_at, timezone, mode, location, meet_link,
                               status, booked_via, source_type, source_id, customer_id)
  values (p_kind, v_title, left(p_description, 4000), p_host, p_created_by, p_start, greatest(p_end, p_start + interval '15 minutes'),
          coalesce((select timezone from public.meeting_host_settings where host_id = p_host), 'Asia/Kolkata'),
          v_mode, left(p_location, 500), v_link, p_status, 'SYSTEM', p_source, p_source_id, p_customer)
  on conflict (source_type, source_id) where source_type is not null do update set
    kind = excluded.kind, title = excluded.title, description = excluded.description, host_id = excluded.host_id,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at, mode = excluded.mode, location = excluded.location,
    meet_link = coalesce(excluded.meet_link, case when excluded.mode = 'GOOGLE_MEET' then public.meetings.meet_link end),
    status = excluded.status, customer_id = coalesce(excluded.customer_id, public.meetings.customer_id),
    version = public.meetings.version + case when (public.meetings.starts_at, public.meetings.ends_at, public.meetings.status, public.meetings.title, public.meetings.host_id)
                                                   is distinct from (excluded.starts_at, excluded.ends_at, excluded.status, excluded.title, excluded.host_id) then 1 else 0 end
  returning * into m;
  if v_email is not null then
    insert into public.meeting_attendees (meeting_id, email, name, phone, role)
    values (m.id, v_email, left(p_guest_name, 200), left(p_guest_phone, 40), 'EXTERNAL') on conflict do nothing;
  end if;
  if p_staff_guest is not null and p_staff_guest <> p_host then
    insert into public.meeting_attendees (meeting_id, profile_id, role) values (m.id, p_staff_guest, 'REQUIRED') on conflict do nothing;
  end if;
  if v_prev.id is null then
    insert into public.meeting_events (meeting_id, actor_id, kind, data) values (m.id, auth.uid(), 'MIRRORED', jsonb_build_object('source', p_source));
  elsif (v_prev.starts_at, v_prev.status) is distinct from (m.starts_at, m.status) then
    insert into public.meeting_events (meeting_id, actor_id, kind, data)
    values (m.id, auth.uid(), case when m.status = 'CANCELLED' then 'CANCELLED' when m.starts_at <> v_prev.starts_at then 'RESCHEDULED' else 'UPDATED' end,
            jsonb_build_object('source', p_source, 'from', v_prev.starts_at, 'to', m.starts_at));
  end if;
end $$;

-- Business Associate demos (the demo's contact is invited by e-mail when the contact has one)
create or replace function private.tg_ba_demos_mirror()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c record;
begin
  select coalesce(nullif(btrim(cu.email), ''), ba.profile ->> 'email') as email, coalesce(cu.name, cu.company) as name, cu.phone, cu.id as customer_id
    into c from public.ba_contacts ba left join public.customers cu on cu.id = ba.lead_id where ba.id = new.contact_id;
  perform private.mtg_mirror('ba_demo', new.id, 'DEMO', new.title, new.description, new.assigned_to, new.created_by, new.starts_at, new.ends_at,
    case new.mode when 'IN_PERSON' then 'IN_PERSON' else 'GOOGLE_MEET' end, new.location, new.meeting_link,
    case new.status when 'CANCELLED' then 'CANCELLED' when 'COMPLETED' then 'COMPLETED' else 'SCHEDULED' end,
    c.email, c.name, c.phone, null, c.customer_id);
  return new;
exception when others then
  -- the demo itself must never fail because of the calendar
  raise warning 'meeting mirror of demo % failed: %', new.id, sqlerrm;
  return new;
end $$;
revoke all on function private.tg_ba_demos_mirror() from public, anon, authenticated;
drop trigger if exists ba_demos_meeting_mirror on public.ba_demos;
create trigger ba_demos_meeting_mirror after insert or update on public.ba_demos for each row execute function private.tg_ba_demos_mirror();

-- recruitment interviews (the interviewer hosts; the candidate is invited by e-mail)
create or replace function private.tg_career_interviews_mirror()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c record;
begin
  select a.snapshot -> 'profile' ->> 'email' as email, a.snapshot -> 'profile' ->> 'name' as name, a.snapshot -> 'profile' ->> 'phone' as phone,
         coalesce(p.title, 'Interview') as job
    into c from public.career_applications a left join public.career_postings p on p.id = a.posting_id where a.id = new.application_id;
  perform private.mtg_mirror('career_interview', new.id, 'INTERVIEW',
    'Interview: ' || coalesce(c.name, 'Candidate') || ' — ' || c.job,
    initcap(replace(lower(new.round), '_', ' ')) || ' round', coalesce(new.interviewer_id, new.recorded_by), new.recorded_by,
    new.scheduled_at, new.scheduled_at + interval '1 hour',
    case new.mode when 'IN_PERSON' then 'IN_PERSON' when 'PHONE' then 'PHONE' else 'GOOGLE_MEET' end, new.location, null,
    case new.status when 'CANCELLED' then 'CANCELLED' when 'COMPLETED' then 'COMPLETED' else 'SCHEDULED' end,
    c.email, c.name, c.phone);
  return new;
exception when others then
  raise warning 'meeting mirror of interview % failed: %', new.id, sqlerrm;
  return new;
end $$;
revoke all on function private.tg_career_interviews_mirror() from public, anon, authenticated;
drop trigger if exists career_interviews_meeting_mirror on public.career_interviews;
create trigger career_interviews_meeting_mirror after insert or update on public.career_interviews for each row execute function private.tg_career_interviews_mirror();

-- employee meetings with HR, once HR has confirmed a time (HR hosts; the employee is invited)
create or replace function private.tg_employee_meetings_mirror()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_tz text;
begin
  if new.confirmed_date is null or new.confirmed_time is null or new.assigned_hr_id is null then
    return new;
  end if;
  if new.status not in ('SCHEDULED', 'CANCELLED', 'COMPLETED', 'DECLINED')
     and not exists (select 1 from public.meetings where source_type = 'employee_meeting' and source_id = new.id) then
    return new;
  end if;
  v_tz := coalesce((select timezone from public.meeting_host_settings where host_id = new.assigned_hr_id), 'Asia/Kolkata');
  v_start := (new.confirmed_date + new.confirmed_time) at time zone v_tz;
  perform private.mtg_mirror('employee_meeting', new.id, 'HR_MEETING', 'HR meeting ' || new.meeting_reference || ': ' || new.subject,
    null, new.assigned_hr_id, new.assigned_hr_id, v_start, v_start + interval '30 minutes',
    case coalesce(new.confirmed_mode, new.meeting_mode) when 'ONLINE' then 'GOOGLE_MEET' else 'IN_PERSON' end, new.meeting_location, new.meeting_link,
    case new.status when 'SCHEDULED' then 'SCHEDULED' when 'COMPLETED' then 'COMPLETED' else 'CANCELLED' end,
    null, null, null, new.employee_id);
  return new;
exception when others then
  raise warning 'meeting mirror of HR meeting % failed: %', new.id, sqlerrm;
  return new;
end $$;
revoke all on function private.tg_employee_meetings_mirror() from public, anon, authenticated;
drop trigger if exists employee_meetings_meeting_mirror on public.employee_meeting_requests;
create trigger employee_meetings_meeting_mirror after insert or update on public.employee_meeting_requests
  for each row execute function private.tg_employee_meetings_mirror();

-- what is already planned (from today on) joins the engine once; re-running changes nothing
do $$
begin
  update public.ba_demos set updated_at = updated_at where starts_at > now() and status in ('SCHEDULED', 'RESCHEDULED')
     and not exists (select 1 from public.meetings m where m.source_type = 'ba_demo' and m.source_id = ba_demos.id);
  update public.career_interviews set version = version where scheduled_at > now() and status = 'SCHEDULED'
     and not exists (select 1 from public.meetings m where m.source_type = 'career_interview' and m.source_id = career_interviews.id);
  update public.employee_meeting_requests set updated_at = updated_at where status = 'SCHEDULED' and confirmed_date >= current_date
     and not exists (select 1 from public.meetings m where m.source_type = 'employee_meeting' and m.source_id = employee_meeting_requests.id);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  -- signed-in staff
  foreach f in array array[
    'public.mtg_directory(text)', 'public.mtg_google_status()', 'public.mtg_busy(uuid[], timestamptz, timestamptz)', 'public.mtg_create(jsonb)',
    'public.mtg_list(timestamptz, timestamptz, uuid)', 'public.mtg_detail(uuid)', 'public.mtg_pending_approvals()',
    'public.mtg_decide(uuid, text, text, timestamptz, timestamptz, integer)', 'public.mtg_answer_proposal(uuid, boolean)',
    'public.mtg_reschedule(uuid, timestamptz, timestamptz, text, integer)', 'public.mtg_cancel(uuid, text, integer)', 'public.mtg_complete(uuid, text)',
    'public.mtg_respond(uuid, text)', 'public.mtg_my_settings()', 'public.mtg_set_availability(jsonb)', 'public.mtg_booking_type_save(jsonb)',
    'public.mtg_set_delegates(uuid[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- the server only (public booking pages, Google sync, e-mails, reminders)
  foreach f in array array[
    'public.mtg_public_page(text)', 'public.mtg_public_book(jsonb)', 'public.mtg_public_get(uuid)', 'public.mtg_public_cancel(uuid, text)',
    'public.mtg_public_answer_proposal(uuid, boolean)', 'public.mtg_sync_claim(integer)',
    'public.mtg_sync_result(uuid, integer, boolean, text, text, text, text, boolean, boolean)', 'public.mtg_connection_broken(uuid, text)',
    'public.mtg_connection_saved(uuid)', 'public.mtg_enqueue_reminders()', 'public.mtg_mail_claim(integer)', 'public.mtg_mail_result(bigint, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- helpers
  foreach f in array array[
    'private.mtg_me()', 'private.mtg_is_ceo(uuid)', 'private.mtg_is_delegate(uuid, uuid)', 'private.mtg_can_view(public.meetings, uuid)',
    'private.mtg_can_manage(public.meetings, uuid)', 'private.mtg_can_decide(public.meetings, uuid)', 'private.mtg_event(uuid, text, text, jsonb)',
    'private.mtg_kind_label(text)', 'private.mtg_when(timestamptz, text)', 'private.mtg_staff_ids(public.meetings)',
    'private.mtg_notify_staff(public.meetings, text, text, text, uuid, text)', 'private.mtg_notify_deciders(public.meetings, text, text)',
    'private.mtg_mail_externals(public.meetings, text, timestamptz)', 'private.mtg_host_conflict(uuid, timestamptz, timestamptz, uuid)',
    'private.mtg_lock_host(uuid)', 'private.mtg_json(public.meetings, uuid)', 'private.mtg_for_update(uuid, integer)',
    'private.mtg_answer_proposal(public.meetings, boolean, uuid)', 'private.mtg_booking_type_json(public.meeting_booking_types)',
    'private.mtg_settings_json(uuid)',
    'private.mtg_mirror(text, uuid, text, text, text, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
