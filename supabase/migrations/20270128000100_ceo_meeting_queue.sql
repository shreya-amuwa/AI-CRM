-- =============================================================================
-- The Super Admin's meeting queue (docs/MEETINGS_GOOGLE_CALENDAR.md "The Super Admin's meeting queue").
-- Run after 20270122000400_bug_team_lead_assignment.sql. Additive and safe to run twice; nothing is deleted.
--
--   * Enter / Exit Meeting again for the Super Admin, next to every other employee (who keep theirs exactly as in 20270122000100).
--   * "Ask the CEO for time" while the Super Admin is BUSY: the request joins the queue (status PENDING_AVAILABILITY, the time asked kept in
--     requested_starts_at / requested_ends_at). While AVAILABLE, asking works as before (the Super Admin approves).
--   * EXIT CONFIRMS EXACTLY ONE: when the Super Admin's status goes from BUSY to AVAILABLE, the oldest request still waiting (created first,
--     still PENDING_AVAILABILITY) is confirmed in the same transaction, under the Super Admin's booking lock:
--       - it starts at the moment of Exit (to the minute) and lasts as long as was asked;
--       - the meeting room: Google Meet when the organiser's Google Calendar is connected (the sync creates the Meet link), otherwise the
--         Super Admin's fixed meeting-room link (meeting_host_settings.room_link); with neither, the e-mail says the link follows. No link is
--         ever made up;
--       - status SCHEDULED (it leaves the queue), history and audit; the employee and the Super Admin are notified, and the e-mail
--         "Your meeting is scheduled — join now" (kind QUEUE_CONFIRMED) is queued once to the employee and once to the Super Admin.
--     The other requests keep waiting: the next Exit confirms the next one. A second Exit click (already AVAILABLE) confirms nothing; an Enter
--     that wins the lock first means the Exit finds the Super Admin BUSY again and confirms nothing; a withdrawn or cancelled request is no
--     longer PENDING_AVAILABILITY and is skipped.
-- =============================================================================

-- the fixed meeting-room link (used when Google Calendar is not connected)
alter table public.meeting_host_settings add column if not exists room_link text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meeting_host_settings_room_link_check') then
    alter table public.meeting_host_settings add constraint meeting_host_settings_room_link_check
      check (room_link is null or (length(room_link) <= 500 and room_link ~* '^https://[^\s]+$'));
  end if;
end $$;

-- the e-mail of a confirmed queued meeting
alter table public.meeting_mail_outbox drop constraint if exists meeting_mail_outbox_kind_check;
alter table public.meeting_mail_outbox add constraint meeting_mail_outbox_kind_check
  check (kind in ('REQUEST_RECEIVED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'DECLINED', 'PROPOSED', 'REMINDER_24H', 'REMINDER_1H', 'QUEUE_CONFIRMED'));

create or replace function public.mtg_room_link()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  return jsonb_build_object('roomLink', (select room_link from public.meeting_host_settings where host_id = me.id));
end $$;

create or replace function public.mtg_room_link_set(p_link text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
begin
  -- only the Super Admin's link is ever used (their queue), so only they keep one
  if me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the CEO sets the meeting room link for their queue.' using errcode = '42501';
  end if;
  if v_link is not null and (v_link !~* '^https://[^\s]+$' or length(v_link) > 500) then
    raise exception 'VALIDATION_ERROR: Give the meeting room link (https://...).' using errcode = '22023';
  end if;
  insert into public.meeting_host_settings (host_id, room_link) values (me.id, v_link)
  on conflict (host_id) do update set room_link = excluded.room_link, updated_at = now();
  perform private.write_audit('MEETING_ROOM_LINK_SET', 'profile', me.id, me.department_id, me.team_id, jsonb_build_object('set', v_link is not null));
  return jsonb_build_object('roomLink', v_link);
end $$;

-- ---------------------------------------------------------------------------
-- Status: everyone's, the Super Admin's included again; the Super Admin's own view carries the queue
-- ---------------------------------------------------------------------------
create or replace function private.mtg_presence_json(p_host uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'hostId', h.id, 'hostName', h.full_name, 'position', h.position,
    'status', coalesce(p.status, 'AVAILABLE'), 'since', p.since, 'updatedAt', p.updated_at, 'isCeo', h.role = 'SUPER_ADMIN',
    'meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at, 'endsAt', m.ends_at, 'mode', m.mode, 'meetLink', m.meet_link)
                  from public.meetings m where m.id = p.meeting_id and private.mtg_can_view(m, p_viewer)),
    'pending', case when p_viewer = h.id and h.role = 'SUPER_ADMIN' then coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title,
                    'startsAt', coalesce(m.requested_starts_at, m.starts_at), 'endsAt', coalesce(m.requested_ends_at, m.ends_at), 'requestedBy', c.full_name,
                    'createdAt', m.created_at) order by m.created_at, m.id)
                  from public.meetings m left join public.profiles c on c.id = m.created_by
                 where m.host_id = h.id and m.status = 'PENDING_AVAILABILITY'), '[]'::jsonb) end,
    'pendingCount', (select count(*) from public.meetings m where m.host_id = h.id and m.status = 'PENDING_AVAILABILITY'
                       and (p_viewer = h.id or m.created_by = p_viewer)))
    from public.profiles h left join public.meeting_presence p on p.host_id = h.id
   where h.id = p_host
$$;

drop function if exists public.mtg_presence();
create or replace function public.mtg_presence(p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  if p_ids is null then
    return jsonb_build_array(private.mtg_presence_json(me.id, me.id));
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 100 then
    raise exception 'VALIDATION_ERROR: Ask for at most 100 people.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(private.mtg_presence_json(p.id, me.id) order by p.full_name)
                     from public.profiles p where p.id = any (p_ids) and p.status = 'ACTIVE'), '[]'::jsonb);
end $$;

-- the CEOs' status, for "Ask the CEO for time" and the header badge
create or replace function public.mtg_ceo_presence()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  return coalesce((select jsonb_agg(private.mtg_presence_json(p.id, me.id) order by p.full_name)
                     from public.profiles p where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'), '[]'::jsonb);
end $$;

create or replace function public.mtg_presence_enter(p_meeting uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
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

-- confirm the next queued request of a Super Admin who just became AVAILABLE (called inside Exit, under the host lock): exactly one
create or replace function private.mtg_confirm_next(p_host uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  h public.profiles;
  v_start timestamptz := date_trunc('minute', now());
  v_len interval;
  v_room text;
  v_google boolean;
  v_pos integer;
begin
  select * into h from public.profiles where id = p_host;
  -- the oldest request still waiting; one that was withdrawn or cancelled is no longer PENDING_AVAILABILITY and is never picked
  select * into m from public.meetings
   where host_id = p_host and status = 'PENDING_AVAILABILITY'
   order by created_at, id limit 1 for update skip locked;
  if m.id is null then
    return null;
  end if;
  v_len := greatest(coalesce(m.requested_ends_at - m.requested_starts_at, m.ends_at - m.starts_at, interval '30 minutes'), interval '5 minutes');
  v_google := private.mtg_connected(private.mtg_organiser(m));
  v_room := (select room_link from public.meeting_host_settings where host_id = p_host);
  update public.meetings
     set status = 'SCHEDULED', starts_at = v_start, ends_at = v_start + v_len,
         mode = case when v_google then 'GOOGLE_MEET' when v_room is not null then 'ONLINE_LINK' else mode end,
         meet_link = case when v_google then null when v_room is not null then v_room else meet_link end,
         decided_by = p_host, decided_at = now(), version = version + 1,
         google_sync_status = case when v_google then 'PENDING' else google_sync_status end, google_sync_after = now()
   where id = m.id
  returning * into m;
  perform private.mtg_event(m.id, 'AUTO_SCHEDULED', null,
    jsonb_build_object('startsAt', m.starts_at, 'endsAt', m.ends_at, 'requestedStartsAt', m.requested_starts_at, 'room', case when v_google then 'GOOGLE_MEET' when v_room is not null then 'ROOM_LINK' else 'NONE' end));
  -- the one who asked (private.notify leaves out the one acting, the Super Admin here: so both are written directly)
  if m.created_by is not null then
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
    values (m.created_by, 'MEETING_SCHEDULED', 'Your meeting with ' || h.full_name || ' is now: ' || m.title,
      h.full_name || ' is available. Your queued meeting starts now (' || private.mtg_when(m.starts_at, m.timezone) || '). Join the meeting room from Meetings.',
      'meeting', m.id, p_host, jsonb_build_object('meetingId', m.id, 'startsAt', m.starts_at), 'urgent');
  end if;
  select count(*) into v_pos from public.meetings where host_id = p_host and status = 'PENDING_AVAILABILITY';
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
  values (p_host, 'MEETING_QUEUE_SCHEDULED', 'Next queued meeting scheduled: ' || m.title,
    'With ' || coalesce((select full_name from public.profiles where id = m.created_by), 'a colleague') || ', starting now. '
      || case when v_pos = 0 then 'No other request is waiting.' else v_pos || ' more waiting; the next Exit confirms the next one.' end,
    'meeting', m.id, p_host, jsonb_build_object('meetingId', m.id), 'normal');
  -- the e-mails: "scheduled, join now" to the employee and the Super Admin (once per meeting version); guests outside the company as usual
  insert into public.meeting_mail_outbox (meeting_id, to_email, to_name, kind, meeting_version, to_profile_id)
  select m.id, lower(btrim(p.email)), p.full_name, 'QUEUE_CONFIRMED', m.version, p.id
    from public.profiles p where p.id in (m.created_by, p_host) and nullif(btrim(coalesce(p.email, '')), '') is not null
  on conflict do nothing;
  insert into public.meeting_mail_outbox (meeting_id, to_email, to_name, kind, meeting_version)
  select m.id, lower(a.email), a.name, 'CONFIRMED', m.version from public.meeting_attendees a
   where a.meeting_id = m.id and a.profile_id is null and a.email is not null
  on conflict do nothing;
  perform private.write_audit('MEETING_QUEUE_SCHEDULED', 'meeting', m.id, h.department_id, h.team_id,
    jsonb_build_object('host', p_host, 'requestedBy', m.created_by, 'startsAt', m.starts_at, 'stillWaiting', v_pos));
  return jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at, 'endsAt', m.ends_at, 'requestedStartsAt', m.requested_starts_at,
    'moved', true, 'requestedBy', m.created_by, 'stillWaiting', v_pos);
end $$;

create or replace function public.mtg_presence_exit(p_busy jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  v_now public.meeting_presence;
  v_done jsonb := null;
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
    -- the Super Admin just became free: the next queued request (one) is confirmed now
    if me.role = 'SUPER_ADMIN' then
      v_done := private.mtg_confirm_next(me.id);
      update public.meeting_presence_log l set scheduled_count = case when v_done is null then 0 else 1 end
       where l.id = (select x.id from public.meeting_presence_log x where x.host_id = me.id order by x.entered_at desc limit 1);
    end if;
  end if;
  return private.mtg_presence_json(me.id, me.id)
    || jsonb_build_object('scheduled', case when v_done is null then '[]'::jsonb else jsonb_build_array(v_done) end);
end $$;

-- ---------------------------------------------------------------------------
-- Asking the CEO for time while BUSY joins the queue (20270122000100 + the queue)
-- ---------------------------------------------------------------------------
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
  v_waiting boolean := false;
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
  -- the CEO is in a meeting (Enter Meeting): the request joins the queue; each Exit confirms the next one, starting then (no time is held now)
  v_waiting := v_request and private.mtg_host_busy(v_host);
  if not v_waiting then
    v_conflict := private.mtg_host_conflict(v_host, v_start, v_end);
    if v_conflict is not null and (v_request or v_host <> me.id or not coalesce((p ->> 'allowOverlap')::boolean, false)) then
      raise exception 'CONFLICT: % a meeting at that time. Pick another time.',
        case when v_host = me.id then 'You already have' else (select full_name from public.profiles where id = v_host) || ' already has' end using errcode = 'P0001';
    end if;
  end if;

  insert into public.meetings (kind, title, description, request_message, host_id, created_by, starts_at, ends_at, timezone, mode, location, meet_link,
                               status, requires_approval, booked_via, customer_id, requested_starts_at, requested_ends_at)
  values (v_kind, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), nullif(btrim(coalesce(p ->> 'message', '')), ''),
          v_host, me.id, v_start, v_end,
          coalesce(nullif(p ->> 'timezone', ''), (select timezone from public.meeting_host_settings where host_id = v_host), 'Asia/Kolkata'),
          v_mode, nullif(btrim(coalesce(p ->> 'location', '')), ''),
          case when v_mode = 'ONLINE_LINK' then nullif(btrim(coalesce(p ->> 'meetLink', '')), '') end,
          case when v_waiting then 'PENDING_AVAILABILITY' when v_request then 'REQUESTED' else 'SCHEDULED' end, v_request, 'STAFF',
          private.try_uuid(p ->> 'customerId'),
          case when v_waiting then v_start end, case when v_waiting then v_end end)
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
  perform private.mtg_event(m.id, case when v_waiting then 'REQUESTED_WHILE_BUSY' when v_request then 'REQUESTED' else 'SCHEDULED' end, null,
    jsonb_build_object('startsAt', m.starts_at, 'endsAt', m.ends_at, 'overlapAllowed', v_conflict is not null, 'toStatus', m.status));
  if v_waiting then
    -- a receipt for the one who asked only; the busy CEO is not interrupted
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
    values (me.id, 'MEETING_PENDING_AVAILABILITY', 'Request queued: ' || m.title,
      (select full_name from public.profiles where id = v_host) || ' is in another meeting. Your request is in the queue (position '
        || (select count(*) from public.meetings q where q.host_id = v_host and q.status = 'PENDING_AVAILABILITY') || '); when they exit a meeting, the next request in the queue is confirmed to start then.',
      'meeting', m.id, me.id, jsonb_build_object('meetingId', m.id), 'normal');
  elsif v_request then
    perform private.mtg_notify_deciders(m, 'Meeting request from ' || me.full_name,
      m.title || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '. Approve, reschedule or reject.');
  else
    perform private.mtg_notify_staff(m, 'MEETING_INVITED', 'New ' || lower(private.mtg_kind_label(m.kind)) || ': ' || m.title,
      'By ' || me.full_name || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '.', me.id);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  end if;
  perform private.write_audit('MEETING_' || case when v_waiting then 'PENDING_AVAILABILITY' when v_request then 'REQUESTED' else 'SCHEDULED' end, 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('kind', m.kind, 'host', m.host_id, 'startsAt', m.starts_at));
  return private.mtg_json(m, me.id);
end $$;


do $$
declare
  f text;
begin
  foreach f in array array['private.mtg_presence_json(uuid, uuid)', 'private.mtg_confirm_next(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.mtg_presence(uuid[])', 'public.mtg_ceo_presence()', 'public.mtg_presence_enter(uuid)', 'public.mtg_presence_exit(jsonb)',
    'public.mtg_create(jsonb)', 'public.mtg_room_link()', 'public.mtg_room_link_set(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
