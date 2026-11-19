-- =============================================================================
-- Meetings: the creator organises the Google event, colleagues get the meeting e-mail, only participants see a meeting
-- (docs/superpowers/specs/2026-11-19-meetings-creator-invites-design.md). Additive and safe to run twice; run after
-- 20270101000500_meetings_google_calendar.sql.
--
-- 1. ORGANISER. A meeting's Google event lives on the calendar of the person who created it (created_by), so Google e-mails the
--    invitation, every change and the cancellation from that person's Gmail to everyone else (the host included). Meetings without a
--    creator (BA demos, interviews, HR meetings, public booking links) keep the host's calendar. google_owner_id remembers whose
--    calendar holds the event, so later changes go to the same calendar; events synced before this migration stay on the host's.
-- 2. E-MAIL TO COLLEAGUES. The outbox also gets one e-mail per colleague taking part (host, creator, invited colleagues) when a meeting
--    is scheduled / approved, moved or cancelled, and the creator is told when a request is declined. The server skips a colleague's
--    e-mail when Google already sent the invitation from the organiser's calendar; the organiser always gets it (Google does not e-mail
--    the organiser). E-mails the CRM sends name the organiser ("<name> via Amuwa CRM", replies to the organiser).
-- 3. PARTICIPANTS ONLY. A Super Admin no longer sees, changes or decides meetings they take no part in. A request for a Super Admin's
--    time still reaches them (they are its host), and one Super Admin may still decide for another.
-- =============================================================================

alter table public.meetings add column if not exists google_owner_id uuid references public.profiles(id) on delete set null;
alter table public.meeting_mail_outbox add column if not exists to_profile_id uuid references public.profiles(id) on delete set null;

-- events already on a calendar stay where they are: on the host's (the only calendar used before this migration)
update public.meetings set google_owner_id = host_id where google_owner_id is null and google_event_id is not null;

-- whose Google Calendar holds (or will hold) the event
create or replace function private.mtg_organiser(m public.meetings)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(m.google_owner_id, m.created_by, m.host_id)
$$;
revoke all on function private.mtg_organiser(public.meetings) from public, anon, authenticated;

create or replace function private.mtg_connected(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.google_calendar_connections g where g.profile_id = p_profile and g.status = 'CONNECTED')
$$;
revoke all on function private.mtg_connected(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. The organiser's calendar decides whether there is anything to send to Google
-- ---------------------------------------------------------------------------
create or replace function private.tg_meetings_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.google_sync_status := case when private.mtg_connected(coalesce(new.google_owner_id, new.created_by, new.host_id)) then 'PENDING' else 'NOT_CONNECTED' end;
    new.google_sync_after := now();
    return new;
  end if;
  if (new.title, new.description, new.starts_at, new.ends_at, new.status, new.mode, new.location, new.host_id, new.timezone)
     is distinct from (old.title, old.description, old.starts_at, old.ends_at, old.status, old.mode, old.location, old.host_id, old.timezone)
     or new.version is distinct from old.version then
    new.updated_at := now();
    if new.google_sync_status is not distinct from old.google_sync_status then
      new.google_sync_status := case when private.mtg_connected(coalesce(new.google_owner_id, new.created_by, new.host_id)) then 'PENDING' else 'NOT_CONNECTED' end;
      new.google_sync_attempts := 0;
      new.google_sync_after := now();
      new.google_sync_error := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_meetings_touch() from public, anon, authenticated;

create or replace function public.mtg_sync_claim(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  -- the organiser's connection was lost since: nothing to sync to
  update public.meetings m set google_sync_status = 'NOT_CONNECTED'
   where m.google_sync_status in ('PENDING', 'FAILED') and not private.mtg_connected(private.mtg_organiser(m));
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
  return coalesce((select jsonb_agg(private.mtg_json(m, null) || jsonb_build_object('googleCalendarId', m.google_calendar_id,
            'googleOwnerId', private.mtg_organiser(m), 'organizerEmail', o.email, 'organizerName', o.full_name))
            from public.meetings m left join public.profiles o on o.id = private.mtg_organiser(m) where m.id = any (v_ids)), '[]'::jsonb);
end $$;

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
      -- the calendar that now holds the event (the next change goes there); none once the event is removed
      google_owner_id = case when p_event_removed then null
                             when p_event_id is not null then coalesce(google_owner_id, private.mtg_organiser(m))
                             else google_owner_id end,
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
      -- the person whose calendar could not be updated is told
      perform private.notify_once(private.mtg_organiser(m), 'MEETING_SYNC_FAILED', 'Google Calendar could not be updated: ' || m.title,
        left(coalesce(p_error, 'Google Calendar refused the change.'), 300), 'meeting', m.id, jsonb_build_object('meetingId', m.id));
    end if;
  end if;
end $$;

-- a (re)connected calendar: the meetings it organises are sent to Google
create or replace function public.mtg_connection_saved(p_profile uuid)
returns void language sql security definer set search_path = '' as $$
  update public.meetings m set google_sync_status = 'PENDING', google_sync_attempts = 0, google_sync_after = now(), google_sync_error = null
   where coalesce(m.google_owner_id, m.created_by, m.host_id) = p_profile and m.google_sync_status in ('NOT_CONNECTED', 'FAILED') and m.ends_at > now()
     and m.status in ('SCHEDULED', 'CANCELLED', 'DECLINED')
$$;

-- ---------------------------------------------------------------------------
-- 2. The meeting e-mail: guests outside the company (as before) and the colleagues taking part
-- ---------------------------------------------------------------------------
create or replace function private.mtg_mail_externals(m public.meetings, p_kind text, p_send_after timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.meeting_mail_outbox (meeting_id, to_email, to_name, kind, meeting_version, send_after)
  select m.id, lower(a.email), a.name, p_kind, m.version, p_send_after
    from public.meeting_attendees a
   where a.meeting_id = m.id and a.profile_id is null and a.email is not null
  on conflict do nothing;

  -- colleagues: scheduled / approved, moved, cancelled (everyone taking part); declined (the one who asked)
  if p_kind in ('CONFIRMED', 'RESCHEDULED', 'CANCELLED') then
    insert into public.meeting_mail_outbox (meeting_id, to_email, to_name, kind, meeting_version, send_after, to_profile_id)
    select m.id, lower(btrim(p.email)), p.full_name, p_kind, m.version, p_send_after, p.id
      from public.profiles p
     where p.id in (select m.host_id union select m.created_by
                    union select a.profile_id from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id is not null)
       and nullif(btrim(coalesce(p.email, '')), '') is not null
    on conflict do nothing;
  elsif p_kind = 'DECLINED' and m.created_by is not null and m.created_by <> m.host_id then
    insert into public.meeting_mail_outbox (meeting_id, to_email, to_name, kind, meeting_version, send_after, to_profile_id)
    select m.id, lower(btrim(p.email)), p.full_name, p_kind, m.version, p_send_after, p.id
      from public.profiles p where p.id = m.created_by and nullif(btrim(coalesce(p.email, '')), '') is not null
    on conflict do nothing;
  end if;
end $$;
revoke all on function private.mtg_mail_externals(public.meetings, text, timestamptz) from public, anon, authenticated;

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
            'meetingVersion', o.meeting_version, 'toProfileId', o.to_profile_id,
            'organizerEmail', og.email, 'organizerName', og.full_name, 'meeting', private.mtg_json(m, null)) order by o.id)
            from public.meeting_mail_outbox o join public.meetings m on m.id = o.meeting_id
            left join public.profiles og on og.id = private.mtg_organiser(m)
           where o.id = any (v_ids)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Only the people taking part see a meeting
-- ---------------------------------------------------------------------------
-- who may see a meeting: its host, whoever booked it, a colleague invited to it, the host's delegates
create or replace function private.mtg_can_view(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (
    m.host_id = p_profile or m.created_by = p_profile
    or exists (select 1 from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id = p_profile)
    or private.mtg_is_delegate(m.host_id, p_profile))
$$;

-- who may change it (reschedule, cancel, mark done): the host, whoever booked it, the host's delegates
create or replace function private.mtg_can_manage(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (m.host_id = p_profile or m.created_by = p_profile or private.mtg_is_delegate(m.host_id, p_profile))
$$;

-- who decides a request for the host's time: the host, the host's delegates, and a Super Admin for another Super Admin
create or replace function private.mtg_can_decide(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (m.host_id = p_profile or private.mtg_is_delegate(m.host_id, p_profile)
    or (private.mtg_is_ceo(p_profile) and private.mtg_is_ceo(m.host_id)))
$$;

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
            or private.mtg_is_delegate(m.host_id, me.id))), '[]'::jsonb);
end $$;

revoke all on function public.mtg_list(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.mtg_list(timestamptz, timestamptz, uuid) to authenticated, service_role;
do $$
declare
  f text;
begin
  foreach f in array array['public.mtg_sync_claim(integer)', 'public.mtg_mail_claim(integer)', 'public.mtg_connection_saved(uuid)',
    'public.mtg_sync_result(uuid, integer, boolean, text, text, text, text, boolean, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['private.mtg_can_view(public.meetings, uuid)', 'private.mtg_can_manage(public.meetings, uuid)',
    'private.mtg_can_decide(public.meetings, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
