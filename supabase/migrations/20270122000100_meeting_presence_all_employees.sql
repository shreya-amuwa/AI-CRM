-- =============================================================================
-- Enter Meeting / Exit Meeting for every employee EXCEPT the Super Admin (docs/MEETINGS_GOOGLE_CALENDAR.md "Employee availability").
-- Run after 20270116000400_meeting_live_availability.sql. Additive and safe to run twice; no data is deleted.
--
-- What changes (the owner asked to move the control from the Super Admin to everyone else):
--   * mtg_presence_enter / mtg_presence_exit: any ACTIVE Department Head, Team Lead or Team Member (Operations Heads are Department Heads)
--     for themself; a Super Admin gets FORBIDDEN, whatever the screen shows. Same table (meeting_presence) and timestamp log
--     (meeting_presence_log: entered_at / exited_at) as before.
--   * The CEO's "pending availability" queue ends: a Super Admin cannot be BUSY any more. Requests that were waiting become ordinary
--     requests for the Super Admin to approve (status REQUESTED, nothing is lost); a Super Admin still marked BUSY is set AVAILABLE and the
--     open log entry is closed. Asking the CEO for time works as it always did (the Super Admin approves, proposes or declines).
--   * mtg_presence(ids): the live BUSY / AVAILABLE status of the people asked about (the scheduler's colleague picker), or of oneself.
--     No meeting details of anyone else.
--   * Conflict prevention: a meeting cannot be booked with a colleague who is BUSY right now when it starts within the next 30 minutes
--     ("X is in a meeting right now"). Later times stay bookable (nobody knows when they will exit); the screens show the BUSY status.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The Super Admin's waiting queue becomes ordinary requests; a Super Admin is never BUSY
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select m.id from public.meetings m where m.status = 'PENDING_AVAILABILITY' loop
    update public.meetings set status = 'REQUESTED', version = version + 1 where id = r.id;
    perform private.mtg_event(r.id, 'MOVED_TO_REQUESTS', 'Enter / Exit Meeting no longer applies to the Super Admin', '{}'::jsonb);
  end loop;
end $$;
update public.meeting_presence_log l set exited_at = now()
 where l.exited_at is null and l.host_id in (select id from public.profiles where role = 'SUPER_ADMIN');
update public.meeting_presence p set status = 'AVAILABLE', meeting_id = null, since = now(), updated_at = now()
 where p.status = 'BUSY' and p.host_id in (select id from public.profiles where role = 'SUPER_ADMIN');

-- ---------------------------------------------------------------------------
-- 2. Who may use Enter / Exit: an active employee who is not a Super Admin
-- ---------------------------------------------------------------------------
create or replace function private.mtg_presence_me()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  if me.role = 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Enter Meeting and Exit Meeting are for employees. The Super Admin''s availability is not tracked.' using errcode = '42501';
  end if;
  return me;
end $$;

-- one person's status as others see it; the meeting itself only for the person and those allowed to see that meeting
create or replace function private.mtg_presence_json(p_host uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'hostId', h.id, 'hostName', h.full_name, 'position', h.position,
    'status', coalesce(p.status, 'AVAILABLE'), 'since', p.since, 'updatedAt', p.updated_at,
    'meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at, 'endsAt', m.ends_at, 'mode', m.mode, 'meetLink', m.meet_link)
                  from public.meetings m where m.id = p.meeting_id and private.mtg_can_view(m, p_viewer)),
    'pending', null::jsonb, 'pendingCount', 0)
    from public.profiles h left join public.meeting_presence p on p.host_id = h.id
   where h.id = p_host
$$;

-- p_ids null: the caller's own status ([] for a Super Admin); otherwise the status of those people (at most 100, active staff, not the
-- Super Admin, whose availability is not tracked)
drop function if exists public.mtg_presence();
create or replace function public.mtg_presence(p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  if p_ids is null then
    if me.role = 'SUPER_ADMIN' then
      return '[]'::jsonb;
    end if;
    return jsonb_build_array(private.mtg_presence_json(me.id, me.id));
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 100 then
    raise exception 'VALIDATION_ERROR: Ask for at most 100 people.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(private.mtg_presence_json(p.id, me.id) order by p.full_name)
                     from public.profiles p
                    where p.id = any (p_ids) and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb);
end $$;

create or replace function public.mtg_presence_enter(p_meeting uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_presence_me();
  m public.meetings;
  v_now public.meeting_presence;
begin
  if p_meeting is not null then
    select * into m from public.meetings where id = p_meeting;
    if m.id is null or not private.mtg_can_view(m, me.id) then
      raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
    end if;
    if m.status not in ('SCHEDULED', 'COMPLETED') then
      raise exception 'VALIDATION_ERROR: Choose a scheduled meeting.' using errcode = '22023';
    end if;
  end if;
  perform private.mtg_lock_host(me.id);
  select * into v_now from public.meeting_presence where host_id = me.id for update;
  if v_now.status = 'BUSY' then
    -- a second click (or another tab): already in a meeting, nothing changes
    return private.mtg_presence_json(me.id, me.id);
  end if;
  insert into public.meeting_presence (host_id, status, meeting_id, since, updated_at) values (me.id, 'BUSY', p_meeting, now(), now())
  on conflict (host_id) do update set status = 'BUSY', meeting_id = excluded.meeting_id, since = excluded.since, updated_at = excluded.updated_at;
  insert into public.meeting_presence_log (host_id, meeting_id, entered_at) values (me.id, p_meeting, now());
  if p_meeting is not null then
    perform private.mtg_event(p_meeting, 'HOST_ENTERED', null, jsonb_build_object('at', now(), 'by', me.id));
  end if;
  perform private.write_audit('MEETING_PRESENCE_ENTERED', 'profile', me.id, me.department_id, me.team_id, jsonb_build_object('meetingId', p_meeting));
  return private.mtg_presence_json(me.id, me.id);
end $$;

-- p_busy is kept so older servers keep working; it is no longer used (nothing waits for an employee to be free)
create or replace function public.mtg_presence_exit(p_busy jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_presence_me();
  v_now public.meeting_presence;
begin
  perform private.mtg_lock_host(me.id);
  select * into v_now from public.meeting_presence where host_id = me.id for update;
  if v_now.status = 'BUSY' then
    update public.meeting_presence set status = 'AVAILABLE', meeting_id = null, since = now(), updated_at = now() where host_id = me.id;
    update public.meeting_presence_log set exited_at = now() where host_id = me.id and exited_at is null;
    if v_now.meeting_id is not null then
      perform private.mtg_event(v_now.meeting_id, 'HOST_EXITED', null, jsonb_build_object('at', now(), 'enteredAt', v_now.since, 'by', me.id));
    end if;
    perform private.write_audit('MEETING_PRESENCE_EXITED', 'profile', me.id, me.department_id, me.team_id,
      jsonb_build_object('meetingId', v_now.meeting_id, 'enteredAt', v_now.since));
  end if;
  return private.mtg_presence_json(me.id, me.id) || jsonb_build_object('scheduled', '[]'::jsonb);
end $$;

-- the old safety net of the CEO queue: nothing waits any more (kept so a server that still calls them gets an empty answer)
create or replace function public.mtg_pending_hosts()
returns jsonb language sql stable security definer set search_path = '' as $$ select '[]'::jsonb $$;
create or replace function public.mtg_pending_process(p_host uuid, p_busy jsonb default null)
returns jsonb language sql security definer set search_path = '' as $$ select '[]'::jsonb $$;

-- ---------------------------------------------------------------------------
-- 3. Conflict prevention: nobody is booked into a meeting starting soon while they are in another one
-- ---------------------------------------------------------------------------
-- The first of p_people (other than the one booking) who is BUSY now, when the meeting starts within 30 minutes; null otherwise.
create or replace function private.mtg_busy_now(p_people uuid[], p_start timestamptz, p_me uuid)
returns text language sql stable security definer set search_path = '' as $$
  select pr.full_name from public.meeting_presence p join public.profiles pr on pr.id = p.host_id
   where p_start < now() + interval '30 minutes'
     and p.status = 'BUSY' and p.host_id = any (p_people) and p.host_id <> p_me and pr.role <> 'SUPER_ADMIN'
   order by pr.full_name limit 1
$$;

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
  v_busy text;
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
  -- the CEO's time is asked for, never taken: everybody but the CEO themselves sends a request (no shortcut for delegates)
  v_request := private.mtg_is_ceo(v_host) and v_host <> me.id;
  if v_request and length(btrim(coalesce(p ->> 'description', ''))) < 5 then
    raise exception 'VALIDATION_ERROR: Describe the agenda or purpose of the meeting (at least 5 characters).' using errcode = '22023';
  end if;
  if length(coalesce(p ->> 'message', '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The message can have at most 2000 characters.' using errcode = '22023';
  end if;

  -- a colleague who is in a meeting right now cannot be booked into one that starts within 30 minutes
  v_busy := private.mtg_busy_now(array(select private.try_uuid(x) from jsonb_array_elements_text(coalesce(p -> 'attendeeIds', '[]'::jsonb)) x) || v_host,
                                 v_start, me.id);
  if v_busy is not null then
    raise exception 'CONFLICT: % is in a meeting right now (Busy). Pick a later time, or wait until they exit their meeting.', v_busy using errcode = 'P0001';
  end if;

  perform private.mtg_lock_host(v_host);
  v_conflict := private.mtg_host_conflict(v_host, v_start, v_end);
  if v_conflict is not null and (v_request or v_host <> me.id or not coalesce((p ->> 'allowOverlap')::boolean, false)) then
    raise exception 'CONFLICT: % a meeting at that time. Pick another time.',
      case when v_host = me.id then 'You already have' else (select full_name from public.profiles where id = v_host) || ' already has' end using errcode = 'P0001';
  end if;

  insert into public.meetings (kind, title, description, request_message, host_id, created_by, starts_at, ends_at, timezone, mode, location, meet_link,
                               status, requires_approval, booked_via, customer_id)
  values (v_kind, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), nullif(btrim(coalesce(p ->> 'message', '')), ''),
          v_host, me.id, v_start, v_end,
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
    jsonb_build_object('startsAt', m.starts_at, 'endsAt', m.ends_at, 'overlapAllowed', v_conflict is not null, 'toStatus', m.status));
  if v_request then
    perform private.mtg_notify_deciders(m, 'Meeting request from ' || me.full_name,
      m.title || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '. Approve, reschedule or reject.');
  else
    perform private.mtg_notify_staff(m, 'MEETING_INVITED', 'New ' || lower(private.mtg_kind_label(m.kind)) || ': ' || m.title,
      'By ' || me.full_name || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '.', me.id);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  end if;
  perform private.write_audit('MEETING_' || case when v_request then 'REQUESTED' else 'SCHEDULED' end, 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('kind', m.kind, 'host', m.host_id, 'startsAt', m.starts_at));
  return private.mtg_json(m, me.id);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['private.mtg_presence_me()', 'private.mtg_presence_json(uuid, uuid)', 'private.mtg_busy_now(uuid[], timestamptz, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.mtg_presence(uuid[])', 'public.mtg_presence_enter(uuid)', 'public.mtg_presence_exit(jsonb)', 'public.mtg_create(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.mtg_pending_hosts()', 'public.mtg_pending_process(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
