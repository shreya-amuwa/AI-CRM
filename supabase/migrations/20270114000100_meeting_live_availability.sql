-- =============================================================================
-- Live meeting availability of the CEO (Super Admin): Enter / Exit Meeting, and requests that wait for the CEO to be free.
-- Builds on 20270101000500_meetings_google_calendar.sql and 20270113000100_meetings_creator_organiser.sql (one meetings system; nothing
-- is duplicated).
--
--   * public.meeting_presence: ONE row per Super Admin, AVAILABLE or BUSY, since when, and the meeting they are in. Every signed-in
--     employee may read it (it holds no meeting details), and it is in the Realtime publication, so every dashboard updates live.
--     Only the Super Admin themself changes it, through mtg_presence_enter / mtg_presence_exit.
--   * public.meeting_presence_log: every Enter and Exit, with the times (the meeting start and end as they really happened).
--   * A meeting status PENDING_AVAILABILITY. "Ask the CEO for time" while the CEO is BUSY is SAVED (never refused) in this status, with
--     the requested date, time, length, purpose and who asked. It does not hold the time and gets no Google event yet.
--   * Exit Meeting (and, as a safety net, every automation dispatch) schedules the waiting requests in the order they were made, under the
--     CEO's booking lock: the first free slot at or after the requested time (never in the past) inside the CEO's working hours, not
--     overlapping any held meeting nor the Google busy times the server passes in. Each becomes SCHEDULED (Google event and guest e-mails
--     follow through the existing sync); the one who asked is told the confirmed time, and that it changed when it did.
--   * A meeting that is already confirmed is never touched by any of this.
--
-- Additive and safe to run twice. Replaces public.mtg_create and public.mtg_cancel (same signatures; only the waiting state is added).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
alter table public.meetings add column if not exists requested_starts_at timestamptz;
alter table public.meetings add column if not exists requested_ends_at timestamptz;

do $$
declare
  c text;
begin
  -- the status list gains PENDING_AVAILABILITY (the old check is replaced by the same list plus it)
  for c in select con.conname from pg_constraint con
            where con.conrelid = 'public.meetings'::regclass and con.contype = 'c'
              and pg_get_constraintdef(con.oid) ilike '%status%REQUESTED%PROPOSED%SCHEDULED%' and con.conname <> 'meetings_status_check_v2' loop
    execute format('alter table public.meetings drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.meetings'::regclass and conname = 'meetings_status_check_v2') then
    alter table public.meetings add constraint meetings_status_check_v2
      check (status in ('REQUESTED', 'PROPOSED', 'SCHEDULED', 'DECLINED', 'CANCELLED', 'COMPLETED', 'PENDING_AVAILABILITY'));
  end if;
end $$;
create index if not exists meetings_pending_availability_idx on public.meetings (host_id, created_at) where status = 'PENDING_AVAILABILITY';

create table if not exists public.meeting_presence (
  host_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'BUSY')),
  meeting_id uuid references public.meetings (id) on delete set null,
  since timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_presence_log (
  id bigint generated always as identity primary key,
  host_id uuid not null references public.profiles (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  scheduled_count integer not null default 0,
  check (exited_at is null or exited_at >= entered_at)
);
create index if not exists meeting_presence_log_host_idx on public.meeting_presence_log (host_id, entered_at desc);
-- at most one open Enter per host
create unique index if not exists meeting_presence_log_open_key on public.meeting_presence_log (host_id) where exited_at is null;

alter table public.meeting_presence enable row level security;
alter table public.meeting_presence_log enable row level security;
revoke all on public.meeting_presence, public.meeting_presence_log from public, anon, authenticated;
grant select on public.meeting_presence to authenticated;
drop policy if exists meeting_presence_select on public.meeting_presence;
-- every active employee may see whether the CEO is free (status and since only; no meeting details)
create policy meeting_presence_select on public.meeting_presence for select to authenticated
  using ((select private.my_id()) is not null);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_presence') then
    alter publication supabase_realtime add table public.meeting_presence;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.mtg_host_busy(p_host uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meeting_presence p where p.host_id = p_host and p.status = 'BUSY')
$$;

-- The first free start at or after p_from (rounded up to 15 minutes) for p_minutes, inside the host's working hours (default Monday to
-- Saturday 10:00-18:00 in the host's time zone), not overlapping a held meeting of the host (requested, proposed or scheduled) nor any of
-- p_busy (the host's Google busy times). Searches 30 days; null when nothing is free.
create or replace function private.mtg_next_free_slot(p_host uuid, p_from timestamptz, p_minutes integer, p_busy tstzrange[] default '{}',
  p_except uuid default null)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := coalesce((select s.timezone from public.meeting_host_settings s where s.host_id = p_host), 'Asia/Kolkata');
  v_len interval := make_interval(mins => p_minutes);
  v_from timestamptz := to_timestamp(ceil(extract(epoch from greatest(p_from, now())) / 900) * 900);
  v_day date := (v_from at time zone v_tz)::date;
  v_has_hours boolean := exists (select 1 from public.meeting_availability a where a.host_id = p_host);
  w record;
  v_start timestamptz;
  v_end timestamptz;
  v_cand timestamptz;
begin
  if p_minutes is null or p_minutes < 5 or p_minutes > 720 then
    return null;
  end if;
  for i in 0..30 loop
    for w in
      select a.start_time, a.end_time from public.meeting_availability a
       where v_has_hours and a.host_id = p_host and a.weekday = extract(dow from v_day + i)::int
      union all
      select time '10:00', time '18:00' where not v_has_hours and extract(dow from v_day + i)::int between 1 and 6
      order by 1
    loop
      v_start := ((v_day + i) + w.start_time) at time zone v_tz;
      v_end := ((v_day + i) + w.end_time) at time zone v_tz;
      v_cand := greatest(v_start, v_from);
      while v_cand + v_len <= v_end loop
        if private.mtg_host_conflict(p_host, v_cand, v_cand + v_len, p_except) is null
           and not exists (select 1 from unnest(coalesce(p_busy, '{}')) b where b && tstzrange(v_cand, v_cand + v_len)) then
          return v_cand;
        end if;
        v_cand := v_cand + interval '15 minutes';
      end loop;
    end loop;
  end loop;
  return null;
end $$;

-- Google busy blocks sent by the server ([{ start, end }]) as ranges; anything unreadable is ignored (it only narrows the free time).
create or replace function private.mtg_busy_ranges(p_busy jsonb)
returns tstzrange[] language plpgsql immutable set search_path = '' as $$
declare
  v tstzrange[] := '{}';
  b jsonb;
begin
  if p_busy is null or jsonb_typeof(p_busy) <> 'array' then
    return v;
  end if;
  for b in select * from jsonb_array_elements(p_busy) limit 2000 loop
    begin
      if (b ->> 'end')::timestamptz > (b ->> 'start')::timestamptz then
        v := v || tstzrange((b ->> 'start')::timestamptz, (b ->> 'end')::timestamptz);
      end if;
    exception when others then
      null;
    end;
  end loop;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The waiting requests: scheduled in the order they were made
-- ---------------------------------------------------------------------------
create or replace function private.mtg_process_pending(p_host uuid, p_busy jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_busy tstzrange[] := private.mtg_busy_ranges(p_busy);
  v_host_name text := (select full_name from public.profiles where id = p_host);
  m public.meetings;
  v_slot timestamptz;
  v_len interval;
  v_moved boolean;
  v_out jsonb := '[]'::jsonb;
begin
  perform private.mtg_lock_host(p_host);
  if private.mtg_host_busy(p_host) then
    return v_out;   -- still in a meeting: everything keeps waiting
  end if;
  for m in select * from public.meetings x
            where x.host_id = p_host and x.status = 'PENDING_AVAILABILITY'
            order by x.created_at, x.id
            for update loop
    v_len := m.ends_at - m.starts_at;
    v_slot := private.mtg_next_free_slot(p_host, greatest(m.starts_at, now() + interval '5 minutes'),
                                         (extract(epoch from v_len) / 60)::int, v_busy, m.id);
    if v_slot is null then
      continue;   -- nothing free in the next 30 days: it keeps waiting and is tried again on the next run
    end if;
    v_moved := v_slot <> m.starts_at;
    update public.meetings
       set status = 'SCHEDULED', starts_at = v_slot, ends_at = v_slot + v_len,
           requested_starts_at = coalesce(requested_starts_at, m.starts_at), requested_ends_at = coalesce(requested_ends_at, m.ends_at),
           decided_at = now(), decision_note = 'Scheduled automatically when ' || coalesce(v_host_name, 'the CEO') || ' became available.',
           version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'AUTO_SCHEDULED', null,
      jsonb_build_object('requestedStartsAt', m.requested_starts_at, 'startsAt', m.starts_at, 'endsAt', m.ends_at, 'moved', v_moved));
    -- the one who asked: the confirmed time, and that it moved when it did
    perform private.notify(m.created_by, 'MEETING_SCHEDULED', 'Meeting with ' || coalesce(v_host_name, 'the CEO') || ' scheduled: ' || m.title,
      'Confirmed for ' || private.mtg_when(m.starts_at, m.timezone) || '.', 'meeting', m.id,
      jsonb_build_object('meetingId', m.id, 'startsAt', m.starts_at), 'normal');
    if v_moved then
      perform private.notify(m.created_by, 'MEETING_MOVED', 'New time for your meeting with ' || coalesce(v_host_name, 'the CEO'),
        'The time you asked for (' || private.mtg_when(m.requested_starts_at, m.timezone) || ') was no longer free. It is booked for '
          || private.mtg_when(m.starts_at, m.timezone) || ' instead.', 'meeting', m.id,
        jsonb_build_object('meetingId', m.id, 'startsAt', m.starts_at, 'requestedStartsAt', m.requested_starts_at), 'urgent');
    end if;
    -- the host, and colleagues invited to it (not the one who asked: told above)
    perform private.mtg_notify_staff(m, 'MEETING_INVITED', 'Booked automatically: ' || m.title,
      private.mtg_when(m.starts_at, m.timezone) || '.', m.created_by);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values ((select id from public.profiles where id = auth.uid()), 'MEETING_AUTO_SCHEDULED', 'meeting', m.id,
            jsonb_build_object('host', m.host_id, 'requestedStartsAt', m.requested_starts_at, 'startsAt', m.starts_at, 'moved', v_moved));
    v_out := v_out || jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at, 'endsAt', m.ends_at,
                                         'requestedStartsAt', m.requested_starts_at, 'moved', v_moved, 'requestedBy', m.created_by);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Enter / Exit Meeting (the Super Admin, for themself only)
-- ---------------------------------------------------------------------------
create or replace function private.mtg_presence_json(p_host uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'hostId', h.id, 'hostName', h.full_name, 'position', h.position,
    'status', coalesce(p.status, 'AVAILABLE'), 'since', p.since, 'updatedAt', p.updated_at,
    -- the meeting itself only for whoever may see it
    'meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at, 'endsAt', m.ends_at, 'mode', m.mode, 'meetLink', m.meet_link)
                  from public.meetings m where m.id = p.meeting_id and private.mtg_can_view(m, p_viewer)),
    -- the CEO's own queue of requests waiting for them to be free
    'pending', case when p_viewer = h.id then coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at,
                    'endsAt', m.ends_at, 'requestedBy', c.full_name, 'createdAt', m.created_at) order by m.created_at, m.id)
                  from public.meetings m left join public.profiles c on c.id = m.created_by
                 where m.host_id = h.id and m.status = 'PENDING_AVAILABILITY'), '[]'::jsonb) end,
    'pendingCount', (select count(*) from public.meetings m where m.host_id = h.id and m.status = 'PENDING_AVAILABILITY'
                       and (p_viewer = h.id or m.created_by = p_viewer)))
    from public.profiles h left join public.meeting_presence p on p.host_id = h.id
   where h.id = p_host
$$;

-- every Super Admin's availability (the CEOs who can be asked for time)
create or replace function public.mtg_presence()
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
  if me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can change their meeting availability.' using errcode = '42501';
  end if;
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
    perform private.mtg_event(p_meeting, 'HOST_ENTERED', null, jsonb_build_object('at', now()));
  end if;
  perform private.write_audit('MEETING_PRESENCE_ENTERED', 'profile', me.id, me.department_id, me.team_id, jsonb_build_object('meetingId', p_meeting));
  return private.mtg_presence_json(me.id, me.id);
end $$;

-- p_busy: the CEO's Google busy times (the server reads them), so a waiting request is not put where the CEO is busy in Google
create or replace function public.mtg_presence_exit(p_busy jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  v_now public.meeting_presence;
  v_done jsonb;
  r record;
begin
  if me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can change their meeting availability.' using errcode = '42501';
  end if;
  perform private.mtg_lock_host(me.id);
  select * into v_now from public.meeting_presence where host_id = me.id for update;
  if v_now.status = 'BUSY' then
    update public.meeting_presence set status = 'AVAILABLE', meeting_id = null, since = now(), updated_at = now() where host_id = me.id;
    update public.meeting_presence_log set exited_at = now() where host_id = me.id and exited_at is null;
    if v_now.meeting_id is not null then
      perform private.mtg_event(v_now.meeting_id, 'HOST_EXITED', null, jsonb_build_object('at', now(), 'enteredAt', v_now.since));
    end if;
    perform private.write_audit('MEETING_PRESENCE_EXITED', 'profile', me.id, me.department_id, me.team_id,
      jsonb_build_object('meetingId', v_now.meeting_id, 'enteredAt', v_now.since));
    -- the people waiting: the CEO is free again (each one once, only those who asked)
    for r in select distinct m.created_by from public.meetings m
              where m.host_id = me.id and m.status = 'PENDING_AVAILABILITY' and m.created_by is not null loop
      perform private.notify(r.created_by, 'CEO_AVAILABLE', me.full_name || ' is available again',
        'Your waiting meeting request is being scheduled now.', 'profile', me.id, jsonb_build_object('hostId', me.id), 'normal');
    end loop;
  end if;
  v_done := private.mtg_process_pending(me.id, p_busy);
  update public.meeting_presence_log l set scheduled_count = jsonb_array_length(v_done)
   where l.id = (select x.id from public.meeting_presence_log x where x.host_id = me.id order by x.entered_at desc limit 1);
  return private.mtg_presence_json(me.id, me.id) || jsonb_build_object('scheduled', v_done);
end $$;

-- the safety net (the server's automation dispatch, service role): the hosts that are free and still have waiting requests,
-- and scheduling them (e.g. a request that found no free slot at Exit, or an Exit whose scheduling stopped half-way)
create or replace function public.mtg_pending_hosts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(distinct m.host_id), '[]'::jsonb) from public.meetings m
   where m.status = 'PENDING_AVAILABILITY' and not private.mtg_host_busy(m.host_id)
$$;
create or replace function public.mtg_pending_process(p_host uuid, p_busy jsonb default null)
returns jsonb language sql security definer set search_path = '' as $$
  select private.mtg_process_pending(p_host, p_busy)
$$;

-- ---------------------------------------------------------------------------
-- 5. Asking for the CEO's time while the CEO is BUSY: saved as PENDING_AVAILABILITY (20270101000500 + the waiting state)
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
  -- the CEO is in a meeting: the request is saved and waits; the slot is found when the CEO is free (no time is held now)
  v_waiting := v_request and private.mtg_host_busy(v_host);
  if not v_waiting then
    v_conflict := private.mtg_host_conflict(v_host, v_start, v_end);
    if v_conflict is not null and (v_request or v_host <> me.id or not coalesce((p ->> 'allowOverlap')::boolean, false)) then
      raise exception 'CONFLICT: % a meeting at that time. Pick another time.',
        case when v_host = me.id then 'You already have' else (select full_name from public.profiles where id = v_host) || ' already has' end using errcode = 'P0001';
    end if;
  end if;

  insert into public.meetings (kind, title, description, host_id, created_by, starts_at, ends_at, timezone, mode, location, meet_link,
                               status, requires_approval, booked_via, customer_id, requested_starts_at, requested_ends_at)
  values (v_kind, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_host, me.id, v_start, v_end,
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
    jsonb_build_object('startsAt', m.starts_at, 'endsAt', m.ends_at, 'overlapAllowed', v_conflict is not null));
  if v_waiting then
    -- told to the one who asked only (the CEO is in a meeting; the request is scheduled automatically when they are free)
    -- (a receipt in their own Notification Center: private.notify leaves out the one acting, so it is written here)
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
    values (me.id, 'MEETING_PENDING_AVAILABILITY', 'Request saved: ' || m.title,
      (select full_name from public.profiles where id = v_host) || ' is in another meeting. Your request for '
        || private.mtg_when(m.starts_at, m.timezone) || ' is saved and will be scheduled automatically when they are free.',
      'meeting', m.id, me.id, jsonb_build_object('meetingId', m.id, 'startsAt', m.starts_at), 'normal');
  elsif v_request then
    perform private.mtg_notify_deciders(m, 'Meeting request from ' || me.full_name,
      m.title || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '. Approve, propose another time or decline.');
  else
    perform private.mtg_notify_staff(m, 'MEETING_INVITED', 'New ' || lower(private.mtg_kind_label(m.kind)) || ': ' || m.title,
      'By ' || me.full_name || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '.', me.id);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  end if;
  perform private.write_audit('MEETING_' || case when v_waiting then 'PENDING_AVAILABILITY' when v_request then 'REQUESTED' else 'SCHEDULED' end,
    'meeting', m.id, me.department_id, me.team_id, jsonb_build_object('kind', m.kind, 'host', m.host_id, 'startsAt', m.starts_at));
  return private.mtg_json(m, me.id);
end $$;

-- a waiting request can be cancelled like a request (20270101000500 + PENDING_AVAILABILITY)
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
  if m.status not in ('REQUESTED', 'PROPOSED', 'SCHEDULED', 'PENDING_AVAILABILITY') then
    raise exception 'CONFLICT: This meeting is already %.', lower(m.status) using errcode = 'P0001';
  end if;
  update public.meetings set status = 'CANCELLED', cancel_reason = v_reason, cancelled_by = me.id, version = version + 1
   where id = m.id returning * into m;
  perform private.mtg_event(m.id, 'CANCELLED', v_reason);
  perform private.mtg_notify_staff(m, 'MEETING_CANCELLED', 'Meeting cancelled: ' || m.title,
    private.mtg_when(m.starts_at, m.timezone) || coalesce('. Reason: ' || v_reason, '') || '.', me.id);
  if v_was not in ('REQUESTED', 'PENDING_AVAILABILITY') or m.booked_via = 'BOOKING_LINK' then
    perform private.mtg_mail_externals(m, 'CANCELLED');
  end if;
  perform private.write_audit('MEETING_CANCELLED', 'meeting', m.id, me.department_id, me.team_id, jsonb_build_object('reason', v_reason));
  return private.mtg_json(m, me.id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.mtg_host_busy(uuid)', 'private.mtg_next_free_slot(uuid, timestamptz, integer, tstzrange[], uuid)',
    'private.mtg_busy_ranges(jsonb)', 'private.mtg_process_pending(uuid, jsonb)', 'private.mtg_presence_json(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.mtg_presence()', 'public.mtg_presence_enter(uuid)', 'public.mtg_presence_exit(jsonb)',
    'public.mtg_create(jsonb)', 'public.mtg_cancel(uuid, text, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.mtg_pending_hosts()', 'public.mtg_pending_process(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
