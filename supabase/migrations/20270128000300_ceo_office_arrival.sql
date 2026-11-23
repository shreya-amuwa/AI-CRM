-- =============================================================================
-- CEO office arrival (docs/MEETINGS_GOOGLE_CALENDAR.md "CEO office arrival"). Run after 20270128000200_issue_routing_escalation.sql.
-- Additive and safe to run twice.
--
--   * HR presses "CEO HAS ARRIVED" on the HR dashboard: today's arrival of the CEO (a Super Admin) is recorded once, with the time and who
--     pressed it (ceo_office_arrivals, one row per CEO per day in India time; a second press changes nothing). HR can undo a mistaken press;
--     the row is kept and marked undone.
--   * Every signed-in employee reads the status (ceo_office_status): it only drives the banner on "Ask the CEO for time" (red "has not
--     arrived yet" / green "has arrived"). It NEVER controls meeting requests: mtg_create, approvals and the queue do not read it.
--   * The queue confirmed on Exit (20270128000100) no longer overlaps a meeting the CEO already has confirmed: it starts at the first free
--     moment at or after the Exit.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The arrivals
-- ---------------------------------------------------------------------------
create table if not exists public.ceo_office_arrivals (
  id bigint generated always as identity primary key,
  ceo_id uuid not null references public.profiles (id) on delete cascade,
  -- the office day in India time
  day date not null,
  arrived_at timestamptz not null default now(),
  marked_by uuid references public.profiles (id) on delete set null,
  undone_at timestamptz,
  undone_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
-- one live arrival per CEO per day (a double press, or two HR people at once, record it once)
create unique index if not exists ceo_office_arrivals_day_uidx on public.ceo_office_arrivals (ceo_id, day) where undone_at is null;
create index if not exists ceo_office_arrivals_recent_idx on public.ceo_office_arrivals (day desc, ceo_id);

alter table public.ceo_office_arrivals enable row level security;
revoke all on public.ceo_office_arrivals from public, anon, authenticated;
-- every active employee may see whether the CEO has arrived (it is shown to everyone); nobody writes past the functions
grant select on public.ceo_office_arrivals to authenticated;
drop policy if exists ceo_office_arrivals_select on public.ceo_office_arrivals;
create policy ceo_office_arrivals_select on public.ceo_office_arrivals for select to authenticated
  using ((select private.my_id()) is not null);

-- live: the banner changes at once when HR presses the button (Supabase Realtime, like the BUSY status)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ceo_office_arrivals') then
    alter publication supabase_realtime add table public.ceo_office_arrivals;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Read and press
-- ---------------------------------------------------------------------------
create or replace function private.ceo_office_day()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create or replace function private.ceo_office_json()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'day', private.ceo_office_day(),
    -- HR staff (and the Super Admin) press the button; recruiters and everyone else only read
    'canMark', coalesce(private.is_hr_staff(), false),
    'ceos', coalesce((select jsonb_agg(jsonb_build_object(
        'ceoId', p.id, 'name', p.full_name, 'position', nullif(btrim(coalesce(p.position, '')), ''),
        'arrived', a.id is not null, 'arrivedAt', a.arrived_at, 'markedBy', (select full_name from public.profiles where id = a.marked_by),
        'presence', coalesce((select mp.status from public.meeting_presence mp where mp.host_id = p.id), 'AVAILABLE')) order by p.created_at, p.id)
      from public.profiles p
      left join public.ceo_office_arrivals a on a.ceo_id = p.id and a.day = private.ceo_office_day() and a.undone_at is null
     where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'), '[]'::jsonb))
$$;

create or replace function public.ceo_office_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return private.ceo_office_json();
end $$;

-- the CEO to act on: the one named, or the only CEO there is
create or replace function private.ceo_office_target(p_ceo uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid;
begin
  if not coalesce(private.is_hr_staff(), false) then
    raise exception 'FORBIDDEN: Only HR marks the CEO''s arrival.' using errcode = '42501';
  end if;
  if p_ceo is not null then
    select id into v from public.profiles where id = p_ceo and role = 'SUPER_ADMIN' and status = 'ACTIVE';
    if v is null then
      raise exception 'NOT_FOUND: CEO not found.' using errcode = 'P0002';
    end if;
    return v;
  end if;
  if (select count(*) from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE') <> 1 then
    raise exception 'VALIDATION_ERROR: Choose which CEO has arrived.' using errcode = '22023';
  end if;
  return (select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE');
end $$;

create or replace function public.ceo_mark_arrived(p_ceo uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ceo uuid := private.ceo_office_target(p_ceo);
  v_id bigint;
begin
  insert into public.ceo_office_arrivals (ceo_id, day, marked_by)
  values (v_ceo, private.ceo_office_day(), auth.uid())
  on conflict (ceo_id, day) where undone_at is null do nothing
  returning id into v_id;
  if v_id is not null then
    perform private.write_audit('CEO_OFFICE_ARRIVED', 'profile', v_ceo, null, null, jsonb_build_object('day', private.ceo_office_day()));
  end if;
  return private.ceo_office_json() || jsonb_build_object('duplicate', v_id is null);
end $$;

-- a mistaken press: today's arrival is marked undone (kept for the record); the red banner shows again
create or replace function public.ceo_mark_arrival_undo(p_ceo uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ceo uuid := private.ceo_office_target(p_ceo);
  v_id bigint;
begin
  update public.ceo_office_arrivals set undone_at = now(), undone_by = auth.uid()
   where ceo_id = v_ceo and day = private.ceo_office_day() and undone_at is null
  returning id into v_id;
  if v_id is not null then
    perform private.write_audit('CEO_OFFICE_ARRIVAL_UNDONE', 'profile', v_ceo, null, null, jsonb_build_object('day', private.ceo_office_day()));
  end if;
  return private.ceo_office_json();
end $$;

-- ---------------------------------------------------------------------------
-- 3. The queue confirmed on Exit never overlaps a confirmed meeting (20270128000100 + the first free moment)
-- ---------------------------------------------------------------------------
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
  v_busy_until timestamptz;
  v_moves integer := 0;
begin
  select * into h from public.profiles where id = p_host;
  select * into m from public.meetings
   where host_id = p_host and status = 'PENDING_AVAILABILITY'
   order by created_at, id limit 1 for update skip locked;
  if m.id is null then
    return null;
  end if;
  v_len := greatest(coalesce(m.requested_ends_at - m.requested_starts_at, m.ends_at - m.starts_at, interval '30 minutes'), interval '5 minutes');
  -- a meeting the CEO already has confirmed at that time: start right after it (and after the next one, if that one follows)
  loop
    select max(x.ends_at) into v_busy_until from public.meetings x
     where x.host_id = p_host and x.id <> m.id and x.status = 'SCHEDULED' and tstzrange(x.starts_at, x.ends_at) && tstzrange(v_start, v_start + v_len);
    exit when v_busy_until is null or v_moves >= 50;
    v_start := v_busy_until;
    v_moves := v_moves + 1;
  end loop;
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
    jsonb_build_object('startsAt', m.starts_at, 'endsAt', m.ends_at, 'requestedStartsAt', m.requested_starts_at, 'afterConfirmedMeeting', v_moves > 0,
                       'room', case when v_google then 'GOOGLE_MEET' when v_room is not null then 'ROOM_LINK' else 'NONE' end));
  if m.created_by is not null then
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
    values (m.created_by, 'MEETING_SCHEDULED',
      'Your meeting with ' || h.full_name || case when v_moves = 0 then ' is now: ' else ' is confirmed: ' end || m.title,
      h.full_name || ' is available. Your queued meeting ' || case when v_moves = 0 then 'starts now' else 'starts right after their next confirmed meeting' end
        || ' (' || private.mtg_when(m.starts_at, m.timezone) || '). Join the meeting room from Meetings.',
      'meeting', m.id, p_host, jsonb_build_object('meetingId', m.id, 'startsAt', m.starts_at), 'urgent');
  end if;
  select count(*) into v_pos from public.meetings where host_id = p_host and status = 'PENDING_AVAILABILITY';
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
  values (p_host, 'MEETING_QUEUE_SCHEDULED', 'Next queued meeting scheduled: ' || m.title,
    'With ' || coalesce((select full_name from public.profiles where id = m.created_by), 'a colleague') || ', '
      || case when v_moves = 0 then 'starting now. ' else 'after your next confirmed meeting (' || private.mtg_when(m.starts_at, m.timezone) || '). ' end
      || case when v_pos = 0 then 'No other request is waiting.' else v_pos || ' more waiting; the next Exit confirms the next one.' end,
    'meeting', m.id, p_host, jsonb_build_object('meetingId', m.id), 'normal');
  insert into public.meeting_mail_outbox (meeting_id, to_email, to_name, kind, meeting_version, to_profile_id)
  select m.id, lower(btrim(p.email)), p.full_name, 'QUEUE_CONFIRMED', m.version, p.id
    from public.profiles p where p.id in (m.created_by, p_host) and nullif(btrim(coalesce(p.email, '')), '') is not null
  on conflict do nothing;
  insert into public.meeting_mail_outbox (meeting_id, to_email, to_name, kind, meeting_version)
  select m.id, lower(a.email), a.name, 'CONFIRMED', m.version from public.meeting_attendees a
   where a.meeting_id = m.id and a.profile_id is null and a.email is not null
  on conflict do nothing;
  perform private.write_audit('MEETING_QUEUE_SCHEDULED', 'meeting', m.id, h.department_id, h.team_id,
    jsonb_build_object('host', p_host, 'requestedBy', m.created_by, 'startsAt', m.starts_at, 'stillWaiting', v_pos, 'afterConfirmedMeeting', v_moves > 0));
  return jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at, 'endsAt', m.ends_at, 'requestedStartsAt', m.requested_starts_at,
    'moved', true, 'requestedBy', m.created_by, 'stillWaiting', v_pos, 'startsNow', v_moves = 0);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.ceo_office_day()', 'private.ceo_office_json()', 'private.ceo_office_target(uuid)', 'private.mtg_confirm_next(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.ceo_office_status()', 'public.ceo_mark_arrived(uuid)', 'public.ceo_mark_arrival_undo(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
