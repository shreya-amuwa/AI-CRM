-- =============================================================================
-- Meeting notifications for the Managing Director (Super Admin): management awareness of internal team meetings, reminders before they
-- start, and delivery to their phones / laptops (Task 05). docs/NOTIFICATION_ARCHITECTURE.md.
--
-- Follows 20270207000100_meeting_push.sql, which sends the meeting notices of the people taking part (the Managing Director's own
-- invitations included) to their phones, with 15-minute and at-start reminders. This adds what a Managing Director who is NOT taking part
-- needs; the two never notify the same person about the same thing.
--
-- Root causes found:
--   1. Meeting notifications only ever reached the CRM bell (fixed for participants by 20270207000100).
--   2. Meeting notices go to the people taking part (private.mtg_notify_staff): the Managing Director heard nothing about a team meeting they
--      were not invited to. That privacy rule is right for calendars; oversight needs a separate, narrow notice.
--   3. (In the app: the "Turn on notifications" banner was switched off on the Managing Director's dashboard, so their devices were rarely
--       subscribed at all. Fixed in the screens.)
--
-- What this adds (additive, safe to run twice, nothing existing changed):
--   * Management awareness notices to every active Managing Director who is NOT taking part in the meeting (people taking part keep their
--     invitation notices): an internal team meeting (private.mms_eligible) scheduled, rescheduled or cancelled. A trigger on meetings, so
--     every path that books, moves or cancels one is covered; it never blocks the meeting itself. Type MEETING_OVERSIGHT_* (an invitation
--     is MEETING_*), data.awareness = true. "View Meeting" opens the meeting's read-only report view (outcome fields only, as the meeting
--     summaries), so the Managing Director does not gain the calendars of others.
--   * Reminders to every active Managing Director NOT taking part, `meeting_oversight_settings.remind_minutes` before the start (default
--     15 and 0), once per meeting, time and Managing Director; a reschedule starts new ones, a cancellation stops them (only SCHEDULED
--     meetings). A Managing Director who takes part gets the participants' reminders (20270207000100_meeting_push), never both.
--   * Each of these also goes to the Managing Director's devices through the existing push outbox (kind MEETING), with retries, expiry and
--     invalid-device handling as every other push. The lock-screen text has no meeting title or participants ("Team meeting at 3:00 PM").
-- =============================================================================

create table if not exists public.meeting_oversight_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  push_enabled boolean not null default true,
  remind_minutes integer[] not null default '{15,0}'
    check (cardinality(remind_minutes) <= 4 and remind_minutes <@ '{0,5,10,15,30,60,120}'::integer[]),
  updated_at timestamptz not null default now()
);
insert into public.meeting_oversight_settings (id) values (true) on conflict (id) do nothing;

-- once per meeting, person, event and key (the start time for reminders and moves)
create table if not exists public.meeting_oversight_log (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  event text not null check (event in ('SCHEDULED', 'RESCHEDULED', 'CANCELLED', 'REMINDER')),
  event_key text not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, profile_id, event, event_key)
);
create index if not exists meeting_oversight_log_created_idx on public.meeting_oversight_log (created_at);
alter table public.meeting_oversight_settings enable row level security;
alter table public.meeting_oversight_log enable row level security;
revoke all on table public.meeting_oversight_settings, public.meeting_oversight_log from public, anon, authenticated;

-- push deliveries may now carry meeting notices
alter table public.notification_deliveries drop constraint if exists notification_deliveries_kind_check;
alter table public.notification_deliveries add constraint notification_deliveries_kind_check
  check (kind in ('ATTENDANCE_REMINDER', 'TEST', 'SA_ATTENDANCE', 'COMPANY_NOTICE', 'MEETING'));

-- "Tue 25 Nov, 3:00 PM" in the meeting's time zone
create or replace function private.mtg_short_when(p_at timestamptz, p_tz text)
returns text language sql stable set search_path = '' as $$
  select to_char(p_at at time zone coalesce(nullif(p_tz, ''), 'Asia/Kolkata'), 'Dy DD Mon, FMHH12:MI AM')
$$;

-- one awareness notice (bell + the person's devices), at most once per key
create or replace function private.mtg_oversight_send(m public.meetings, p_profile uuid, p_event text, p_key text, p_type text, p_title text,
  p_body text, p_push_title text, p_push_body text, p_ttl interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_log bigint;
  s public.meeting_oversight_settings;
begin
  insert into public.meeting_oversight_log (meeting_id, profile_id, event, event_key) values (m.id, p_profile, p_event, p_key)
  on conflict (meeting_id, profile_id, event, event_key) do nothing returning id into v_log;
  if v_log is null then
    return false;
  end if;
  perform private.notify(p_profile, p_type, p_title, p_body, 'meeting_summary', m.id,
    jsonb_build_object('meetingId', m.id, 'startsAt', m.starts_at, 'awareness', not (p_profile = any (private.mtg_staff_ids(m))), 'event', p_event),
    case when p_event in ('CANCELLED', 'REMINDER') then 'urgent' else 'normal' end);
  select * into s from public.meeting_oversight_settings where id;
  if coalesce(s.push_enabled, true) then
    insert into public.notification_deliveries (kind, profile_id, subscription_id, device_label, title, body, tag, url, expires_at, next_attempt_at)
    select 'MEETING', p_profile, d.id, d.label, left(p_push_title, 120), left(p_push_body, 300),
           'mtg-' || m.id || '-' || lower(p_event), '/?open=meeting-report&id=' || m.id, now() + p_ttl, now()
      from (select x.id, x.label from public.push_subscriptions x where x.profile_id = p_profile and x.active order by x.created_at desc limit 10) d;
  end if;
  return true;
end $$;

-- the Managing Directors to tell: active, and (for awareness) not taking part
create or replace function private.mtg_oversight_targets(m public.meetings, p_only_outsiders boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'
     and (not p_only_outsiders or not (p.id = any (private.mtg_staff_ids(m))))
$$;

create or replace function private.mtg_oversight_body(m public.meetings)
returns text language sql stable security definer set search_path = '' as $$
  select concat_ws(' · ',
    'Organiser: ' || coalesce((select p.full_name from public.profiles p where p.id = coalesce(m.created_by, m.host_id)), '-'),
    (select 'Department: ' || d.name from public.profiles p join public.departments d on d.id = private.base_department(p.department_id) where p.id = m.host_id),
    private.mtg_when(m.starts_at, m.timezone),
    cardinality(private.mtg_staff_ids(m)) || ' participant' || case when cardinality(private.mtg_staff_ids(m)) = 1 then '' else 's' end)
$$;

-- scheduled / moved / cancelled: a trigger, so every way of booking, moving or cancelling a team meeting is covered
create or replace function private.tg_meetings_oversight()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s public.meeting_oversight_settings;
  v uuid;
  v_event text;
begin
  if not private.mms_eligible(new) then
    return null;
  end if;
  select * into s from public.meeting_oversight_settings where id;
  if not coalesce(s.enabled, true) then
    return null;
  end if;
  if tg_op = 'INSERT' and new.status = 'SCHEDULED' then
    v_event := 'SCHEDULED';
  elsif tg_op = 'UPDATE' and new.status = 'SCHEDULED' and old.status is distinct from 'SCHEDULED' then
    v_event := 'SCHEDULED';
  elsif tg_op = 'UPDATE' and new.status = 'SCHEDULED' and old.status = 'SCHEDULED' and new.starts_at is distinct from old.starts_at then
    v_event := 'RESCHEDULED';
  elsif tg_op = 'UPDATE' and new.status = 'CANCELLED' and old.status = 'SCHEDULED' then
    v_event := 'CANCELLED';
  else
    return null;
  end if;
  -- a moved or cancelled meeting's reminders still waiting to be pushed are no longer true
  if v_event in ('RESCHEDULED', 'CANCELLED') then
    update public.notification_deliveries set status = 'CANCELLED', last_error = 'NO_LONGER_DUE', finished_at = now(), updated_at = now()
     where kind = 'MEETING' and tag = 'mtg-' || new.id || '-reminder' and status in ('PENDING', 'RETRY_PENDING');
  end if;
  for v in select x from private.mtg_oversight_targets(new, true) x loop
    perform private.mtg_oversight_send(new, v, v_event, v_event || ':' || new.starts_at::text || ':' || new.version,
      'MEETING_OVERSIGHT_' || v_event,
      case v_event when 'SCHEDULED' then 'Team meeting scheduled: ' when 'RESCHEDULED' then 'Team meeting rescheduled: ' else 'Team meeting cancelled: ' end || new.title,
      private.mtg_oversight_body(new) || ' · ' || case v_event when 'SCHEDULED' then 'Scheduled'
        when 'RESCHEDULED' then 'Rescheduled from ' || private.mtg_when(old.starts_at, old.timezone) else 'Cancelled' || coalesce(': ' || new.cancel_reason, '') end,
      case v_event when 'SCHEDULED' then 'Team meeting scheduled' when 'RESCHEDULED' then 'Team meeting rescheduled' else 'Team meeting cancelled' end,
      private.mtg_short_when(new.starts_at, new.timezone) || '. Open the CRM for details.',
      interval '12 hours');
  end loop;
  return null;
exception when others then
  -- a notice never blocks the meeting itself
  raise warning 'meeting oversight notice skipped for %: %', new.id, sqlerrm;
  return null;
end $$;
-- deferred to the end of the transaction: a meeting is inserted before its attendees, and the notice needs them (who takes part is not
-- told "for awareness"; the participant count)
drop trigger if exists meetings_oversight on public.meetings;
create constraint trigger meetings_oversight after insert or update of status, starts_at on public.meetings
  deferrable initially deferred
  for each row execute function private.tg_meetings_oversight();

-- the reminders (the 5-minute reminders run, service role: server/automations/attendanceReminders.ts): due within the last 10 minutes, never late, once per meeting, time and person
create or replace function public.mtg_oversight_run(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.meeting_oversight_settings;
  m public.meetings;
  r integer;
  v uuid;
  v_sent integer := 0;
begin
  select * into s from public.meeting_oversight_settings where id;
  if not coalesce(s.enabled, true) or cardinality(coalesce(s.remind_minutes, '{}')) = 0 then
    return jsonb_build_object('reminders', 0);
  end if;
  for m in select x.* from public.meetings x
            where x.status = 'SCHEDULED' and x.starts_at between p_now - interval '10 minutes' and p_now + interval '125 minutes'
              and private.mms_eligible(x) loop
    foreach r in array s.remind_minutes loop
      continue when p_now < m.starts_at - make_interval(mins => r) or p_now > m.starts_at - make_interval(mins => r) + interval '10 minutes';
      for v in select x from private.mtg_oversight_targets(m, true) x loop
        if private.mtg_oversight_send(m, v, 'REMINDER', r || ':' || m.starts_at::text, 'MEETING_OVERSIGHT_REMINDER',
             case when r = 0 then 'Starting now: ' else 'In ' || r || ' minutes: ' end || m.title,
             private.mtg_oversight_body(m),
             case when r = 0 then 'Team meeting starting now' else 'Team meeting in ' || r || ' minutes' end,
             private.mtg_short_when(m.starts_at, m.timezone) || '. Open the CRM for details.',
             make_interval(mins => r + 10)) then
          v_sent := v_sent + 1;
        end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('reminders', v_sent);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['private.mtg_short_when(timestamptz, text)',
    'private.mtg_oversight_send(public.meetings, uuid, text, text, text, text, text, text, text, interval)',
    'private.mtg_oversight_targets(public.meetings, boolean)', 'private.mtg_oversight_body(public.meetings)', 'private.tg_meetings_oversight()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.mtg_oversight_run(timestamptz) from public, anon, authenticated;
grant execute on function public.mtg_oversight_run(timestamptz) to service_role;

-- the Managing Director's settings (Settings > Meeting notifications)
create or replace function public.mtg_oversight_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.meeting_oversight_settings;
begin
  perform private.require_super_admin();
  select * into s from public.meeting_oversight_settings where id;
  return jsonb_build_object('enabled', coalesce(s.enabled, true), 'pushEnabled', coalesce(s.push_enabled, true),
    'remindMinutes', to_jsonb(coalesce(s.remind_minutes, '{15,0}')), 'updatedAt', s.updated_at);
end $$;

create or replace function public.mtg_oversight_settings_set(p_enabled boolean, p_push_enabled boolean, p_remind_minutes integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  before public.meeting_oversight_settings;
  v integer[] := (select coalesce(array_agg(distinct x order by x desc), '{}') from unnest(coalesce(p_remind_minutes, '{}')) x);
begin
  perform private.require_super_admin();
  if p_enabled is null or p_push_enabled is null then
    raise exception 'VALIDATION_ERROR: Choose whether meeting notifications and phone alerts are on.';
  end if;
  if cardinality(v) > 4 or not v <@ '{0,5,10,15,30,60,120}'::integer[] then
    raise exception 'VALIDATION_ERROR: Choose up to 4 reminder times from: at the start, 5, 10, 15, 30, 60 or 120 minutes before.';
  end if;
  insert into public.meeting_oversight_settings (id) values (true) on conflict (id) do nothing;
  select * into before from public.meeting_oversight_settings where id for update;
  update public.meeting_oversight_settings
     set enabled = p_enabled, push_enabled = p_push_enabled, remind_minutes = v, updated_at = now()
   where id;
  perform private.write_audit('MEETING_NOTIFICATION_SETTINGS_CHANGED', 'meeting_oversight_settings', null, null, null,
    jsonb_build_object('before', jsonb_build_object('enabled', before.enabled, 'push_enabled', before.push_enabled, 'remind_minutes', before.remind_minutes),
                       'after', jsonb_build_object('enabled', p_enabled, 'push_enabled', p_push_enabled, 'remind_minutes', v)));
  return public.mtg_oversight_settings_get();
end $$;
revoke all on function public.mtg_oversight_settings_get() from public, anon;
grant execute on function public.mtg_oversight_settings_get() to authenticated;
revoke all on function public.mtg_oversight_settings_set(boolean, boolean, integer[]) from public, anon;
grant execute on function public.mtg_oversight_settings_set(boolean, boolean, integer[]) to authenticated;

notify pgrst, 'reload schema';
