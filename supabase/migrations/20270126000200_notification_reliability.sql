-- =============================================================================
-- Notification reliability: attendance reminders that are not lost, a Resume Work reminder, notification sound settings and
-- Notification Health for the Super Admin and HR (docs/NOTIFICATION_RELIABILITY.md).
-- Run after 20270126000100_department_head_lead_owners.sql. Additive and safe to run twice; pasteable in the Supabase SQL editor. No data is deleted
-- except the delivery history older than 30 days that this migration itself creates.
--
-- ROOT CAUSES this fixes (confirmed in the code of 20270109000200 / server/automations/attendanceReminders.ts):
-- 1. attendance_reminders_due() wrote the reminder to attendance_reminder_log (the "sent once" record) BEFORE any device push. A push that
--    failed (timeout, 429, 5xx, a Worker that stopped half way, the Worker's subrequest limit at 10:00 when everybody is due at once) was
--    never tried again: the log said "sent". A reminder with no device or with push switched off left no trace either.
-- 2. The push result was one of ok / gone / failed per device, with no retry, no per-reminder outcome and nothing an administrator can see.
-- 3. There was no reminder when the lunch allowance runs out (only "Lunch ends in N minutes" a few minutes before, and not at all when
--    less than the warning was left).
--
-- WHAT IS ADDED
-- * notification_deliveries: a database outbox, one row per reminder and device (unique), with explicit statuses PENDING, PROCESSING,
--   ACCEPTED_BY_PUSH_SERVICE, RETRY_PENDING, FAILED, EXPIRED, CANCELLED. Rows are claimed with a lease (for update skip locked), so two
--   scheduled runs never take the same row, and a row whose Worker died is taken again when its lease ends. "Accepted by the push service"
--   is all Web Push can tell: it does not prove the phone showed the notification or made a sound.
-- * attendance_reminders_generate(): the reminder, its bell notification and its delivery rows in ONE transaction (nothing is lost between
--   them). The old attendance_reminders_due() is kept unchanged for an API that has not been redeployed yet.
-- * Before each push the reminder is checked again: punched in / lunch ended / punched out / on leave / switched off -> CANCELLED, so a
--   late retry never says something that is no longer true. A row expires 30 minutes after it was due (the same late limit as before).
-- * RESUME_WORK: "Time to Resume Work" when the open lunch reaches the allowance left for the day (real start time, earlier breaks counted),
--   and one follow-up (attendance_settings.reminder_resume_follow_up_minutes, 10 by default, 0 = none). Nothing after Resume Work or Punch Out.
-- * Scheduler runs, delivery attempts and what each browser reported (permission, audio) for Notification Health; sound settings per person.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings, the reminder log, devices and sound preferences (all additive)
-- ---------------------------------------------------------------------------
alter table public.attendance_settings add column if not exists reminder_resume_follow_up_minutes integer not null default 10;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_settings_resume_follow_up_check') then
    alter table public.attendance_settings add constraint attendance_settings_resume_follow_up_check check (reminder_resume_follow_up_minutes between 0 and 60);
  end if;
end $$;

alter table public.attendance_reminder_log drop constraint if exists attendance_reminder_log_kind_check;
alter table public.attendance_reminder_log add constraint attendance_reminder_log_kind_check
  check (kind in ('PUNCH_IN', 'LUNCH', 'LUNCH_END', 'RESUME_WORK', 'PUNCH_OUT'));
alter table public.attendance_reminder_log
  add column if not exists due_at timestamptz,
  add column if not exists notification_id uuid,
  add column if not exists push_status text check (push_status in ('QUEUED', 'NO_DEVICE', 'PUSH_OFF')),
  add column if not exists devices smallint not null default 0;
create index if not exists attendance_reminder_log_person_date_idx on public.attendance_reminder_log (profile_id, attendance_date);

alter table public.push_subscriptions
  add column if not exists last_attempt_at timestamptz,
  add column if not exists failure_count integer not null default 0,
  add column if not exists last_failure_code text check (length(last_failure_code) <= 40),
  add column if not exists deactivated_reason text check (length(deactivated_reason) <= 40),
  add column if not exists deactivated_at timestamptz,
  add column if not exists test_confirmed_at timestamptz;

alter table public.attendance_reminder_prefs
  add column if not exists sound_attendance boolean not null default true,
  add column if not exists sound_chat boolean not null default true,
  add column if not exists sound_general boolean not null default true,
  add column if not exists sound_confirmed_at timestamptz,
  add column if not exists test_confirmed_at timestamptz,
  add column if not exists test_sound_heard boolean;

-- ---------------------------------------------------------------------------
-- 2. The outbox, its attempts, the scheduler's runs and what browsers report
-- ---------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('ATTENDANCE_REMINDER', 'TEST')),
  reminder_id bigint references public.attendance_reminder_log (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.push_subscriptions (id) on delete set null,
  device_label text check (length(device_label) <= 120),
  requested_by uuid references public.profiles (id) on delete set null,
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 500),
  tag text not null check (length(tag) <= 80),
  url text not null check (url ~ '^/' and length(url) <= 300),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'ACCEPTED_BY_PUSH_SERVICE', 'RETRY_PENDING', 'FAILED', 'EXPIRED', 'CANCELLED')),
  attempts smallint not null default 0,
  max_attempts smallint not null default 4 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  expires_at timestamptz not null,
  last_status_code integer,
  last_error text check (length(last_error) <= 120),
  accepted_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one delivery per reminder and device: a second scheduled run (or a retry of the generation) creates nothing new
create unique index if not exists notification_deliveries_once_uidx on public.notification_deliveries (reminder_id, subscription_id) where reminder_id is not null;
create index if not exists notification_deliveries_queue_idx on public.notification_deliveries (next_attempt_at)
  where status in ('PENDING', 'RETRY_PENDING', 'PROCESSING');
create index if not exists notification_deliveries_person_idx on public.notification_deliveries (profile_id, created_at desc);
create index if not exists notification_deliveries_device_idx on public.notification_deliveries (subscription_id, created_at desc);
create index if not exists notification_deliveries_created_idx on public.notification_deliveries (created_at);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from public, anon, authenticated;

create table if not exists public.notification_delivery_attempts (
  id bigint generated always as identity primary key,
  delivery_id bigint not null references public.notification_deliveries (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome text not null check (outcome in ('ACCEPTED', 'GONE', 'RETRY', 'FAILED')),
  status_code integer,
  error_code text check (length(error_code) <= 120),
  duration_ms integer
);
create index if not exists notification_delivery_attempts_delivery_idx on public.notification_delivery_attempts (delivery_id);
create index if not exists notification_delivery_attempts_time_idx on public.notification_delivery_attempts (attempted_at);
alter table public.notification_delivery_attempts enable row level security;
revoke all on public.notification_delivery_attempts from public, anon, authenticated;

create table if not exists public.notification_scheduler_runs (
  id bigint generated always as identity primary key,
  job text not null default 'ATTENDANCE_REMINDERS' check (job ~ '^[A-Z_]{1,40}$'),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  ok boolean not null,
  push_configured boolean not null,
  generated integer not null default 0,
  bell_written integer not null default 0,
  jobs_created integer not null default 0,
  no_device integer not null default 0,
  attempted integer not null default 0,
  accepted integer not null default 0,
  retry integer not null default 0,
  failed integer not null default 0,
  gone integer not null default 0,
  error text check (length(error) <= 300)
);
create index if not exists notification_scheduler_runs_time_idx on public.notification_scheduler_runs (job, finished_at desc);
alter table public.notification_scheduler_runs enable row level security;
revoke all on public.notification_scheduler_runs from public, anon, authenticated;

-- What a signed-in browser itself reports (it is the only one that knows): notification permission, whether it is subscribed, whether
-- the CRM may play sound. client_id is a random id the browser keeps; no endpoint or key is stored here.
create table if not exists public.notification_client_checks (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  client_id text not null check (client_id ~ '^[A-Za-z0-9-]{8,64}$'),
  label text check (length(label) <= 120),
  permission text not null check (permission in ('granted', 'denied', 'default', 'unsupported')),
  push_state text not null check (push_state in ('on', 'off', 'blocked', 'ios-needs-install', 'unsupported')),
  audio_state text not null check (audio_state in ('running', 'suspended', 'unsupported', 'unknown')),
  standalone boolean not null default false,
  checked_at timestamptz not null default now(),
  primary key (profile_id, client_id)
);
alter table public.notification_client_checks enable row level security;
revoke all on public.notification_client_checks from public, anon, authenticated;

-- History older than 30 days (90 for browser reports) is removed a little at a time by each scheduled run.
create or replace function private.notification_purge()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notification_deliveries where id in (
    select id from public.notification_deliveries where created_at < now() - interval '30 days'
       and status not in ('PENDING', 'PROCESSING', 'RETRY_PENDING') order by created_at limit 2000);
  delete from public.notification_delivery_attempts where id in (
    select id from public.notification_delivery_attempts where attempted_at < now() - interval '30 days' order by attempted_at limit 2000);
  delete from public.notification_scheduler_runs where id in (
    select id from public.notification_scheduler_runs where finished_at < now() - interval '30 days' order by finished_at limit 2000);
  delete from public.notification_client_checks where checked_at < now() - interval '90 days';
end $$;
revoke all on function private.notification_purge() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What is due (adds RESUME_WORK; the rest is unchanged from 20270109000200)
-- ---------------------------------------------------------------------------
create or replace function private.attendance_reminders_compute(p_now timestamptz)
returns table (profile_id uuid, attendance_date date, kind text, step smallint, lunch_id uuid, due_at timestamptz, title text, body text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.attendance_settings;
  v_day date := (p_now at time zone 'Asia/Kolkata')::date;
  v_allow_s numeric := private.lunch_allowance() * 60;
begin
  select * into s from public.attendance_settings where id;
  if s.id is null or not s.reminders_enabled or s.reminders_paused_on = v_day
     or not (extract(isodow from v_day)::integer = any(s.reminder_days)) then
    return;
  end if;
  return query
  with staff as (
    select p.id, t.punch_in, t.lunch, t.punch_out, r.punch_in_at, r.punch_out_at,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED'
                     and v_day between l.start_date and l.end_date and l.leave_type = 'FULL_DAY') as leave_full,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED'
                     and v_day between l.start_date and l.end_date and l.half_day_shift = 'MORNING') as leave_morning,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED'
                     and v_day between l.start_date and l.end_date and l.half_day_shift = 'AFTERNOON') as leave_afternoon,
           exists (select 1 from public.attendance_lunches l where l.profile_id = p.id and l.attendance_date = v_day) as had_lunch
      from public.profiles p
      cross join lateral private.reminder_times(p.id) t
      left join public.attendance_records r on r.profile_id = p.id and r.attendance_date = v_day
     where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN' and t.enabled
  ),
  timed as (
    select st.id, 'PUNCH_IN'::text as kind, st.punch_in as at_time,
           'Time to Punch In'::text as title, format('Your day starts at %s. Open Attendance to punch in.', private.hhmm(st.punch_in)) as body
      from staff st where st.punch_in_at is null and not st.leave_full and not st.leave_morning
    union all
    select st.id, 'LUNCH', st.lunch, 'Lunch time', 'Start your lunch break in Attendance when you go.'
      from staff st where st.punch_in_at is not null and st.punch_out_at is null and not st.had_lunch and not st.leave_full and not st.leave_afternoon
    union all
    select st.id, 'PUNCH_OUT', st.punch_out, 'Time to Punch Out', format('Your day ends at %s. Punch out before you leave.', private.hhmm(st.punch_out))
      from staff st where st.punch_in_at is not null and st.punch_out_at is null and not st.leave_full and not st.leave_afternoon
  ),
  steps as (
    select tm.*, g.step::smallint as step,
           ((v_day + tm.at_time) at time zone 'Asia/Kolkata') + make_interval(mins => g.step * s.reminder_follow_up_minutes) as due
      from timed tm cross join generate_series(0, 1) g(step)
  ),
  latest as (
    select distinct on (st.id, st.kind) st.* from steps st where st.due <= p_now order by st.id, st.kind, st.step desc
  ),
  open_lunch as (
    select st.id, l.id as lunch_id, l.started_at, (v_allow_s - c.closed_s) as left_s
      from staff st
      join public.attendance_lunches l on l.profile_id = st.id and l.attendance_date = v_day and l.ended_at is null
      cross join lateral (select coalesce(sum(extract(epoch from (x.ended_at - x.started_at))), 0) as closed_s
                            from public.attendance_lunches x where x.profile_id = st.id and x.attendance_date = v_day and x.ended_at is not null) c
     where not st.leave_full and st.punch_out_at is null
  ),
  lunch_end as (
    select ol.id, ol.lunch_id, ol.left_s,
           ol.started_at + make_interval(secs => (ol.left_s - s.reminder_lunch_warning_minutes * 60)::double precision) as due,
           ol.started_at + make_interval(secs => ol.left_s::double precision) as ends_at
      from open_lunch ol
  ),
  -- Resume Work: when the allowance left for the day runs out during this break. A break started with nothing left is reminded after
  -- 5 minutes (not at its first second). Then one follow-up, unless switched off (0).
  resume_steps as (
    select ol.id, ol.lunch_id, g.step::smallint as step,
           greatest(ol.started_at + make_interval(secs => greatest(ol.left_s, 0)::double precision), ol.started_at + interval '5 minutes')
             + make_interval(mins => g.step * s.reminder_resume_follow_up_minutes) as due
      from open_lunch ol
      cross join generate_series(0, case when s.reminder_resume_follow_up_minutes > 0 then 1 else 0 end) g(step)
  ),
  resume_latest as (
    select distinct on (rs.id, rs.lunch_id) rs.* from resume_steps rs where rs.due <= p_now order by rs.id, rs.lunch_id, rs.step desc
  )
  select lt.id, v_day, lt.kind, lt.step, null::uuid, lt.due,
         lt.title || case when lt.step = 1 then ' (reminder)' else '' end, lt.body
    from latest lt where lt.due > p_now - interval '30 minutes'
  union all
  select le.id, v_day, 'LUNCH_END', 0::smallint, le.lunch_id, le.due,
         format('Lunch ends in %s minute%s', m.left_min, case when m.left_min = 1 then '' else 's' end), 'End your lunch break in Attendance when you are back.'
    from lunch_end le
    cross join lateral (select ceil(extract(epoch from (le.ends_at - p_now)) / 60)::integer as left_min) m
   where le.left_s > s.reminder_lunch_warning_minutes * 60 and le.due <= p_now and p_now < le.ends_at
  union all
  select rl.id, v_day, 'RESUME_WORK', rl.step, rl.lunch_id, rl.due,
         'Time to Resume Work' || case when rl.step = 1 then ' (reminder)' else '' end,
         'Your lunch break has ended. Please tap Resume Work in Amuwa CRM.'
    from resume_latest rl where rl.due > p_now - interval '30 minutes';
end $$;
revoke all on function private.attendance_reminders_compute(timestamptz) from public, anon, authenticated;

-- Is this reminder still true right now? Checked before every push (and every retry): nothing is pushed for a day that is over, an action
-- already done, approved leave, an account no longer active, or reminders switched off since.
create or replace function private.attendance_reminder_still_due(p_reminder bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select g.attendance_date = (now() at time zone 'Asia/Kolkata')::date
       and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
       and s.reminders_enabled and s.reminders_paused_on is distinct from g.attendance_date
       and coalesce(pr.enabled, true)
       and not exists (select 1 from public.leave_requests l where l.employee_id = g.profile_id and l.status = 'APPROVED'
                         and g.attendance_date between l.start_date and l.end_date and l.leave_type = 'FULL_DAY')
       and case g.kind
             when 'PUNCH_IN' then r.punch_in_at is null
             when 'LUNCH' then r.punch_in_at is not null and r.punch_out_at is null
                               and not exists (select 1 from public.attendance_lunches l where l.profile_id = g.profile_id and l.attendance_date = g.attendance_date)
             when 'PUNCH_OUT' then r.punch_in_at is not null and r.punch_out_at is null
             else r.punch_out_at is null and exists (select 1 from public.attendance_lunches l where l.id = g.lunch_id and l.ended_at is null)
           end
      from public.attendance_reminder_log g
      join public.profiles p on p.id = g.profile_id
      cross join public.attendance_settings s
      left join public.attendance_reminder_prefs pr on pr.profile_id = g.profile_id
      left join public.attendance_records r on r.profile_id = g.profile_id and r.attendance_date = g.attendance_date
     where g.id = p_reminder and s.id), false)
$$;
revoke all on function private.attendance_reminder_still_due(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Generation: reminder + bell + delivery rows in one transaction (service role, every 5 minutes)
-- ---------------------------------------------------------------------------
-- p_push: whether the API has a working VAPID key pair. Without it no delivery rows are made (PUSH_OFF): a backlog would otherwise be
-- pushed hours later when push is repaired.
create or replace function public.attendance_reminders_generate(p_now timestamptz default now(), p_push boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_log bigint;
  v_note uuid;
  v_jobs integer;
  v_expires timestamptz;
  v_warn integer := coalesce((select reminder_lunch_warning_minutes from public.attendance_settings where id), 5);
  v_generated integer := 0;
  v_bell integer := 0;
  v_created integer := 0;
  v_no_device integer := 0;
begin
  perform private.notification_purge();
  for r in select * from private.attendance_reminders_compute(p_now) order by due_at loop
    insert into public.attendance_reminder_log (profile_id, attendance_date, kind, step, lunch_id, due_at)
    values (r.profile_id, r.attendance_date, r.kind, r.step, r.lunch_id, r.due_at)
    on conflict do nothing
    returning id into v_log;
    continue when v_log is null;
    v_generated := v_generated + 1;
    insert into public.notifications (recipient_id, type, title, body, entity_type, data, priority)
    values (r.profile_id, 'ATTENDANCE_REMINDER', r.title, r.body, 'attendance',
            jsonb_build_object('kind', r.kind, 'step', r.step, 'date', r.attendance_date), 'normal')
    returning id into v_note;
    v_bell := v_bell + 1;
    -- the lunch warning is useless once the break is over; everything else may be late by 30 minutes at most (as before)
    v_expires := case when r.kind = 'LUNCH_END' then greatest(r.due_at + make_interval(mins => v_warn), p_now + interval '2 minutes')
                      else greatest(r.due_at + interval '30 minutes', p_now + interval '10 minutes') end;
    v_jobs := 0;
    if p_push then
      insert into public.notification_deliveries (kind, reminder_id, profile_id, subscription_id, device_label, title, body, tag, url, expires_at, next_attempt_at)
      select 'ATTENDANCE_REMINDER', v_log, r.profile_id, d.id, d.label, r.title, r.body,
             'att-' || lower(r.kind) || '-' || r.attendance_date, '/?open=attendance', v_expires, p_now
        from (select s.id, s.label from public.push_subscriptions s where s.profile_id = r.profile_id and s.active
               order by s.created_at desc limit 10) d
      on conflict do nothing;
      get diagnostics v_jobs = row_count;
    end if;
    v_created := v_created + v_jobs;
    if p_push and v_jobs = 0 then v_no_device := v_no_device + 1; end if;
    update public.attendance_reminder_log
       set notification_id = v_note, devices = v_jobs,
           push_status = case when not p_push then 'PUSH_OFF' when v_jobs = 0 then 'NO_DEVICE' else 'QUEUED' end
     where id = v_log;
  end loop;
  return jsonb_build_object('generated', v_generated, 'bellWritten', v_bell, 'jobsCreated', v_created, 'noDevice', v_no_device, 'pushOff', not p_push);
end $$;
revoke all on function public.attendance_reminders_generate(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.attendance_reminders_generate(timestamptz, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Claiming and reporting deliveries (service role)
-- ---------------------------------------------------------------------------
-- Takes up to p_limit due rows (or exactly p_ids, e.g. a test the API sends at once). Rows past their expiry become EXPIRED; rows whose
-- device was removed, switched off or now belongs to someone else (a shared phone) or whose reminder is no longer true become CANCELLED;
-- a PROCESSING row whose lease ran out (the Worker stopped) is taken again. Each returned row carries a lease token the report must match.
create or replace function public.push_deliveries_claim(p_limit integer default 40, p_lease_seconds integer default 60, p_ids bigint[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v_out jsonb := '[]'::jsonb;
  v_lease uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 500);
  v_secs integer := least(greatest(coalesce(p_lease_seconds, 60), 15), 600);
  v_reason text;
begin
  update public.notification_deliveries
     set status = 'EXPIRED', finished_at = now(), updated_at = now(), lease_token = null, lease_until = null, last_error = coalesce(last_error, 'EXPIRED')
   where expires_at <= now()
     and (status in ('PENDING', 'RETRY_PENDING') or (status = 'PROCESSING' and lease_until < now()))
     and (p_ids is null or id = any(p_ids));

  for d in
    select n.*, s.id as sub_id, s.active as sub_active, s.profile_id as sub_profile, s.endpoint, s.p256dh, s.auth
      from public.notification_deliveries n
      left join public.push_subscriptions s on s.id = n.subscription_id
     where (n.status in ('PENDING', 'RETRY_PENDING') and n.next_attempt_at <= now()
            or n.status = 'PROCESSING' and n.lease_until < now())
       and (p_ids is null or n.id = any(p_ids))
     order by n.next_attempt_at, n.id
     limit v_limit
     for update of n skip locked
  loop
    v_reason := case
      when d.sub_id is null then 'DEVICE_REMOVED'
      when not d.sub_active then 'DEVICE_INACTIVE'
      when d.sub_profile is distinct from d.profile_id then 'DEVICE_REASSIGNED'
      when d.kind = 'ATTENDANCE_REMINDER' and not private.attendance_reminder_still_due(d.reminder_id) then 'NO_LONGER_DUE'
      when d.attempts >= d.max_attempts then 'MAX_ATTEMPTS'
    end;
    if v_reason is not null then
      update public.notification_deliveries
         set status = case when v_reason = 'MAX_ATTEMPTS' then 'FAILED' else 'CANCELLED' end, last_error = v_reason,
             finished_at = now(), updated_at = now(), lease_token = null, lease_until = null
       where id = d.id;
      continue;
    end if;
    v_lease := gen_random_uuid();
    update public.notification_deliveries
       set status = 'PROCESSING', lease_token = v_lease, lease_until = now() + make_interval(secs => v_secs), attempts = attempts + 1, updated_at = now()
     where id = d.id;
    v_out := v_out || jsonb_build_object('id', d.id, 'lease', v_lease, 'subscriptionId', d.sub_id, 'endpoint', d.endpoint, 'p256dh', d.p256dh, 'auth', d.auth,
      'title', d.title, 'body', d.body, 'tag', d.tag, 'url', d.url,
      'ttl', greatest(60, least(86400, floor(extract(epoch from (d.expires_at - now())))::integer)));
  end loop;
  return v_out;
end $$;
revoke all on function public.push_deliveries_claim(integer, integer, bigint[]) from public, anon, authenticated;
grant execute on function public.push_deliveries_claim(integer, integer, bigint[]) to service_role;

-- What each push service answered. outcome: accepted (2xx), gone (404/410: the device unsubscribed or expired, switched off for good),
-- retry (timeout, network, 429, 5xx: tried again 1, 3, 10 minutes later or after Retry-After, at most max_attempts times, never past the
-- expiry), failed (any other answer, e.g. 400/403/413: not retried). A report whose lease no longer matches (the row was taken again) is ignored.
create or replace function public.push_deliveries_report(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record;
  d public.notification_deliveries;
  v_err text;
  v_code text;
  v_counts jsonb := jsonb_build_object('accepted', 0, 'gone', 0, 'retry', 0, 'failed', 0, 'ignored', 0);
  v_key text;
begin
  for e in select * from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb))
             as x(id bigint, lease uuid, outcome text, status integer, error text, "retryAfter" integer, ms integer)
  loop
    select * into d from public.notification_deliveries where id = e.id and lease_token = e.lease and status = 'PROCESSING' for update;
    if d.id is null or e.outcome not in ('accepted', 'gone', 'retry', 'failed') then
      v_counts := jsonb_set(v_counts, '{ignored}', to_jsonb((v_counts ->> 'ignored')::integer + 1));
      continue;
    end if;
    -- only a short, safe code is kept (never a response body, endpoint or key)
    v_err := nullif(left(regexp_replace(coalesce(e.error, ''), '[^A-Za-z0-9_ .:-]', '', 'g'), 120), '');
    v_code := coalesce(e.status::text, left(v_err, 40));
    insert into public.notification_delivery_attempts (delivery_id, outcome, status_code, error_code, duration_ms)
    values (d.id, upper(e.outcome), e.status, v_err, e.ms);
    if e.outcome = 'accepted' then
      update public.notification_deliveries set status = 'ACCEPTED_BY_PUSH_SERVICE', accepted_at = now(), finished_at = now(), last_status_code = e.status,
             last_error = null, lease_token = null, lease_until = null, updated_at = now() where id = d.id;
      update public.push_subscriptions set last_success_at = now(), last_attempt_at = now(), failure_count = 0 where id = d.subscription_id;
    elsif e.outcome = 'gone' then
      update public.notification_deliveries set status = 'FAILED', finished_at = now(), last_status_code = e.status, last_error = 'DEVICE_GONE',
             lease_token = null, lease_until = null, updated_at = now() where id = d.id;
      update public.push_subscriptions set active = false, last_failure_at = now(), last_attempt_at = now(), failure_count = failure_count + 1,
             last_failure_code = v_code, deactivated_reason = 'EXPIRED_AT_PUSH_SERVICE', deactivated_at = now() where id = d.subscription_id;
      update public.notification_deliveries set status = 'CANCELLED', last_error = 'DEVICE_INACTIVE', finished_at = now(), updated_at = now()
       where subscription_id = d.subscription_id and status in ('PENDING', 'RETRY_PENDING');
    elsif e.outcome = 'retry' and d.attempts < d.max_attempts then
      update public.notification_deliveries
         set status = 'RETRY_PENDING', last_status_code = e.status, last_error = v_err, lease_token = null, lease_until = null, updated_at = now(),
             -- (greatest() ignores nulls, so the Retry-After case is spelled out)
             next_attempt_at = now() + make_interval(secs => case when e."retryAfter" is null then (array[60, 180, 600, 900])[least(greatest(d.attempts, 1), 4)]
                                                                  else least(greatest(e."retryAfter", 30), 900) end)
       where id = d.id;
      update public.push_subscriptions set last_failure_at = now(), last_attempt_at = now(), failure_count = failure_count + 1, last_failure_code = v_code
       where id = d.subscription_id;
    else
      update public.notification_deliveries set status = 'FAILED', finished_at = now(), last_status_code = e.status,
             last_error = coalesce(v_err, case when e.outcome = 'retry' then 'MAX_ATTEMPTS' end), lease_token = null, lease_until = null, updated_at = now()
       where id = d.id;
      update public.push_subscriptions set last_failure_at = now(), last_attempt_at = now(), failure_count = failure_count + 1, last_failure_code = v_code
       where id = d.subscription_id;
    end if;
    v_key := e.outcome;
    v_counts := jsonb_set(v_counts, array[v_key], to_jsonb((v_counts ->> v_key)::integer + 1));
  end loop;
  return v_counts;
end $$;
revoke all on function public.push_deliveries_report(jsonb) from public, anon, authenticated;
grant execute on function public.push_deliveries_report(jsonb) to service_role;

-- The chat push (20270111000100) still reports through this one: it now also counts failures and says why a device was switched off.
create or replace function public.push_subscriptions_report(p_ok uuid[], p_gone uuid[], p_failed uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.push_subscriptions set last_success_at = now(), last_attempt_at = now(), failure_count = 0 where id = any(coalesce(p_ok, '{}'));
  update public.push_subscriptions set active = false, last_failure_at = now(), last_attempt_at = now(), failure_count = failure_count + 1,
         last_failure_code = 'GONE', deactivated_reason = 'EXPIRED_AT_PUSH_SERVICE', deactivated_at = now() where id = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set last_failure_at = now(), last_attempt_at = now(), failure_count = failure_count + 1, last_failure_code = 'FAILED'
   where id = any(coalesce(p_failed, '{}'));
end $$;
revoke all on function public.push_subscriptions_report(uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.push_subscriptions_report(uuid[], uuid[], uuid[]) to service_role;

-- A device turned on again (push_subscription_save) starts with a clean record.
create or replace function private.tg_push_subscription_reactivated()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.active and not old.active then
    new.failure_count := 0; new.deactivated_reason := null; new.deactivated_at := null;
  end if;
  return new;
end $$;
drop trigger if exists push_subscriptions_reactivated on public.push_subscriptions;
create trigger push_subscriptions_reactivated before update of active on public.push_subscriptions
  for each row execute function private.tg_push_subscription_reactivated();

-- Each scheduled run, as the API saw it (service role).
create or replace function public.notification_scheduler_run_record(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_scheduler_runs (job, started_at, ok, push_configured, generated, bell_written, jobs_created, no_device,
                                                  attempted, accepted, retry, failed, gone, error)
  values (coalesce(nullif(p ->> 'job', ''), 'ATTENDANCE_REMINDERS'), coalesce((p ->> 'startedAt')::timestamptz, now()), coalesce((p ->> 'ok')::boolean, false),
          coalesce((p ->> 'pushConfigured')::boolean, false), coalesce((p ->> 'generated')::integer, 0), coalesce((p ->> 'bellWritten')::integer, 0),
          coalesce((p ->> 'jobsCreated')::integer, 0), coalesce((p ->> 'noDevice')::integer, 0), coalesce((p ->> 'attempted')::integer, 0),
          coalesce((p ->> 'accepted')::integer, 0), coalesce((p ->> 'retry')::integer, 0), coalesce((p ->> 'failed')::integer, 0),
          coalesce((p ->> 'gone')::integer, 0), left(p ->> 'error', 300));
end $$;
revoke all on function public.notification_scheduler_run_record(jsonb) from public, anon, authenticated;
grant execute on function public.notification_scheduler_run_record(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Test notifications (no attendance record, no reminder log)
-- ---------------------------------------------------------------------------
create or replace function private.push_test_jobs(p_profile uuid, p_by uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids bigint[];
begin
  with ins as (
    insert into public.notification_deliveries (kind, profile_id, subscription_id, device_label, requested_by, title, body, tag, url, expires_at, max_attempts)
    select 'TEST', p_profile, s.id, s.label, p_by, 'Test notification', p_body, 'crm-test', '/?open=attendance', now() + interval '10 minutes', 2
      from public.push_subscriptions s where s.profile_id = p_profile and s.active
    returning id)
  select coalesce(array_agg(id), '{}') into v_ids from ins;
  return jsonb_build_object('ids', to_jsonb(v_ids), 'devices', cardinality(v_ids));
end $$;
revoke all on function private.push_test_jobs(uuid, uuid, text) from public, anon, authenticated;

-- "Send test notification" to my own devices: at most 5 tests in 10 minutes.
create or replace function public.push_test_enqueue()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if (select count(distinct created_at) from public.notification_deliveries
       where kind = 'TEST' and profile_id = me.id and requested_by = me.id and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'CONFLICT: You sent several tests just now. Wait a few minutes and try again.' using errcode = 'P0001';
  end if;
  return private.push_test_jobs(me.id, me.id, 'Notifications work on this device. No action is needed.');
end $$;
revoke all on function public.push_test_enqueue() from public, anon;
grant execute on function public.push_test_enqueue() to authenticated;

-- Super Admin / HR: a controlled test to one employee's devices. At most 3 per employee an hour and 30 per administrator an hour; it also
-- appears in the employee's bell, so they know who sent it and why. Audited.
create or replace function public.notification_admin_test(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.profiles;
  v jsonb;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR and the Super Admin can send a test notification to an employee.' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile and status = 'ACTIVE';
  if t.id is null then
    raise exception 'NOT_FOUND: This employee is not an active account.' using errcode = 'P0001';
  end if;
  if (select count(distinct created_at) from public.notification_deliveries
       where kind = 'TEST' and profile_id = t.id and requested_by is distinct from t.id and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'CONFLICT: Three tests were already sent to this employee in the last hour. Try again later.' using errcode = 'P0001';
  end if;
  if (select count(distinct created_at) from public.notification_deliveries
       where kind = 'TEST' and requested_by = me.id and profile_id <> me.id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'CONFLICT: You sent 30 tests in the last hour. Try again later.' using errcode = 'P0001';
  end if;
  v := private.push_test_jobs(t.id, me.id, 'HR sent this test to check your notifications. No action is needed.');
  perform private.notify(t.id, 'NOTIFICATION_TEST', 'Test notification',
    'HR sent a test notification to check that your devices receive CRM notifications. No action is needed.', 'notification_test', null, '{}'::jsonb, 'normal');
  perform private.write_audit('NOTIFICATION_TEST_SENT', 'profile', t.id, t.department_id, t.team_id, jsonb_build_object('devices', v -> 'devices'));
  return v;
end $$;
revoke all on function public.notification_admin_test(uuid) from public, anon;
grant execute on function public.notification_admin_test(uuid) to authenticated;

-- "Did the test appear / did you hear it?" from the person themselves (optional). p_endpoint (this browser's own subscription) marks
-- that device as confirmed; another person's device is never touched.
create or replace function public.push_test_confirm(p_appeared boolean, p_sound boolean, p_endpoint text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if p_appeared is null then
    raise exception 'VALIDATION_ERROR: Say whether the test notification appeared.' using errcode = 'P0001';
  end if;
  insert into public.attendance_reminder_prefs (profile_id, test_confirmed_at, test_sound_heard, updated_at)
  values (me.id, case when p_appeared then now() end, p_sound, now())
  on conflict (profile_id) do update
    set test_confirmed_at = case when p_appeared then now() else public.attendance_reminder_prefs.test_confirmed_at end,
        test_sound_heard = p_sound, updated_at = now();
  if p_appeared and p_endpoint is not null then
    update public.push_subscriptions set test_confirmed_at = now() where endpoint = p_endpoint and profile_id = me.id;
  end if;
end $$;
revoke all on function public.push_test_confirm(boolean, boolean, text) from public, anon;
grant execute on function public.push_test_confirm(boolean, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Sound settings and what the browser reports (the signed-in person only)
-- ---------------------------------------------------------------------------
create or replace function public.notification_sound_save(p_attendance boolean, p_chat boolean, p_general boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if p_attendance is null or p_chat is null or p_general is null then
    raise exception 'VALIDATION_ERROR: Choose on or off for each sound.' using errcode = 'P0001';
  end if;
  insert into public.attendance_reminder_prefs (profile_id, sound_attendance, sound_chat, sound_general, updated_at)
  values (me.id, p_attendance, p_chat, p_general, now())
  on conflict (profile_id) do update set sound_attendance = excluded.sound_attendance, sound_chat = excluded.sound_chat,
                                         sound_general = excluded.sound_general, updated_at = now();
  return private.attendance_reminder_settings_json(me.id, me.role <> 'SUPER_ADMIN');
end $$;
revoke all on function public.notification_sound_save(boolean, boolean, boolean) from public, anon;
grant execute on function public.notification_sound_save(boolean, boolean, boolean) to authenticated;

-- "I heard the test sound": the only honest evidence that sound works for this person.
create or replace function public.notification_sound_confirm()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  insert into public.attendance_reminder_prefs (profile_id, sound_confirmed_at, updated_at) values (auth.uid(), now(), now())
  on conflict (profile_id) do update set sound_confirmed_at = now(), updated_at = now();
end $$;
revoke all on function public.notification_sound_confirm() from public, anon;
grant execute on function public.notification_sound_confirm() to authenticated;

create or replace function public.notification_client_check(p_client_id text, p_label text, p_permission text, p_push_state text, p_audio_state text, p_standalone boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where id = me and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if coalesce(p_client_id, '') !~ '^[A-Za-z0-9-]{8,64}$' or p_permission not in ('granted', 'denied', 'default', 'unsupported')
     or p_push_state not in ('on', 'off', 'blocked', 'ios-needs-install', 'unsupported') or p_audio_state not in ('running', 'suspended', 'unsupported', 'unknown') then
    raise exception 'VALIDATION_ERROR: This browser sent a device check that is not valid.' using errcode = 'P0001';
  end if;
  insert into public.notification_client_checks (profile_id, client_id, label, permission, push_state, audio_state, standalone, checked_at)
  values (me, p_client_id, left(nullif(btrim(p_label), ''), 120), p_permission, p_push_state, p_audio_state, coalesce(p_standalone, false), now())
  on conflict (profile_id, client_id) do update
    set label = excluded.label, permission = excluded.permission, push_state = excluded.push_state, audio_state = excluded.audio_state,
        standalone = excluded.standalone, checked_at = now();
  -- at most 10 browsers per person are kept
  delete from public.notification_client_checks where profile_id = me and client_id in (
    select client_id from public.notification_client_checks where profile_id = me order by checked_at desc offset 10);
end $$;
revoke all on function public.notification_client_check(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.notification_client_check(text, text, text, text, text, boolean) to authenticated;

-- HR: the follow-up of the Resume Work reminder (0 = none). Audited.
create or replace function public.hr_attendance_resume_follow_up_save(p_minutes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_hr_reminders();
begin
  if p_minutes is null or p_minutes not between 0 and 60 then
    raise exception 'VALIDATION_ERROR: The Resume Work follow-up must be between 0 (none) and 60 minutes' using errcode = 'P0001';
  end if;
  update public.attendance_settings set reminder_resume_follow_up_minutes = p_minutes, updated_at = now() where id;
  perform private.write_audit('ATTENDANCE_REMINDERS_UPDATED', 'attendance_settings', null, me.department_id, me.team_id,
    jsonb_build_object('resumeFollowUpMinutes', p_minutes));
  return private.attendance_reminder_settings_json(me.id, me.role <> 'SUPER_ADMIN');
end $$;
revoke all on function public.hr_attendance_resume_follow_up_save(integer) from public, anon;
grant execute on function public.hr_attendance_resume_follow_up_save(integer) to authenticated;

-- The settings the screens read: as in 20270111000100, plus the Resume Work follow-up and the sound settings.
create or replace function private.attendance_reminder_settings_json(p_profile uuid, p_is_staff boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'company', jsonb_build_object('enabled', s.reminders_enabled, 'punchIn', private.hhmm(s.reminder_punch_in), 'lunch', private.hhmm(s.reminder_lunch),
                                  'punchOut', private.hhmm(s.reminder_punch_out), 'followUpMinutes', s.reminder_follow_up_minutes,
                                  'lunchWarningMinutes', s.reminder_lunch_warning_minutes, 'days', to_jsonb(s.reminder_days),
                                  'resumeFollowUpMinutes', s.reminder_resume_follow_up_minutes, 'lunchAllowanceMinutes', private.lunch_allowance()),
    'mine', case when p_is_staff then jsonb_build_object('enabled', coalesce(p.enabled, true), 'punchIn', private.hhmm(p.punch_in),
                                                         'lunch', private.hhmm(p.lunch), 'punchOut', private.hhmm(p.punch_out)) else 'null'::jsonb end,
    'effective', case when p_is_staff then (select jsonb_build_object('enabled', t.enabled, 'punchIn', private.hhmm(t.punch_in), 'lunch', private.hhmm(t.lunch),
                                                                      'punchOut', private.hhmm(t.punch_out)) from private.reminder_times(p_profile) t)
                      else 'null'::jsonb end,
    'pausedToday', coalesce(s.reminders_paused_on = private.office_today(), false),
    'canManage', private.is_hr_staff(),
    'chatPush', coalesce(p.chat_push, true),
    'sound', jsonb_build_object('attendance', coalesce(p.sound_attendance, true), 'chat', coalesce(p.sound_chat, true),
                                'general', coalesce(p.sound_general, true), 'confirmedAt', p.sound_confirmed_at),
    'testConfirmedAt', p.test_confirmed_at)
  from public.attendance_settings s
  left join public.attendance_reminder_prefs p on p.profile_id = p_profile
  where s.id
$$;
revoke all on function private.attendance_reminder_settings_json(uuid, boolean) from public, anon, authenticated;

-- The person's own devices, without the keys: now also the last failure, why a device was switched off and whether a test was confirmed.
create or replace function public.my_push_devices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'createdAt', created_at, 'lastSuccessAt', last_success_at, 'active', active,
                                               'lastFailureAt', last_failure_at, 'lastFailureCode', last_failure_code, 'deactivatedReason', deactivated_reason,
                                               'testConfirmedAt', test_confirmed_at)
                            order by created_at desc), '[]'::jsonb)
    from public.push_subscriptions where profile_id = auth.uid()
$$;
revoke all on function public.my_push_devices() from public, anon;
grant execute on function public.my_push_devices() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Notification Health (Super Admin and HR staff, not recruiters; every read audited)
-- ---------------------------------------------------------------------------
-- One row per active, attendance-eligible employee (ACTIVE and not the Super Admin: the same people the reminders are for). Shows
-- counts, times, statuses and short failure codes only: no endpoint, key, message text or punch location.
-- p_push_configured: whether the API's VAPID keys work (the API passes it; it only changes what is displayed).
create or replace function private.notification_health_rows(p_push_configured boolean)
returns table (item jsonb)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select s.*, private.office_today() as today,
           s.reminders_enabled and s.reminders_paused_on is distinct from private.office_today() as company_on,
           extract(isodow from private.office_today())::integer = any(s.reminder_days) as reminder_day
      from public.attendance_settings s where s.id
  ),
  staff as (
    select p.id, p.full_name, p.role, p.department_id,
           coalesce(nullif(p.position, ''), (select pd.designation from public.employee_personal_details pd where pd.profile_id = p.id)) as designation,
           private.base_department(p.department_id) as base_dept,
           pr.enabled as pref_enabled, pr.sound_confirmed_at, pr.test_confirmed_at, pr.test_sound_heard,
           t.enabled as eff_enabled, t.punch_in, t.lunch, t.punch_out
      from public.profiles p
      left join public.attendance_reminder_prefs pr on pr.profile_id = p.id
      cross join lateral private.reminder_times(p.id) t
     where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
  ),
  r as (
    select st.*, c.company_on, c.reminder_day, c.today,
      dv.active_devices, dv.inactive_devices, dv.expired_devices, dv.last_success_at, dv.last_failure_at, dv.last_failure_code,
      dl.failed_7d, dl.retry_pending, dl.pending, dl.last_status, dl.last_finished_at, dl.last_error, dl.last_accepted_at,
      lg.today_generated, lg.today_no_device, lg.today_kinds,
      ck.blocked_check, ck.audio_running, ck.audio_suspended, ck.last_check_at,
      lv.on_leave,
      private.attendance_status(st.id, c.today) as attendance_status,
      ar.punch_in_at, ar.punch_out_at
    from staff st cross join cfg c
    cross join lateral (
      select count(*) filter (where s.active) as active_devices,
             count(*) filter (where not s.active) as inactive_devices,
             count(*) filter (where not s.active and s.deactivated_reason = 'EXPIRED_AT_PUSH_SERVICE') as expired_devices,
             max(s.last_success_at) filter (where s.active) as last_success_at,
             max(s.last_failure_at) as last_failure_at,
             (select s2.last_failure_code from public.push_subscriptions s2 where s2.profile_id = st.id and s2.last_failure_at is not null
               order by s2.last_failure_at desc limit 1) as last_failure_code
        from public.push_subscriptions s where s.profile_id = st.id) dv
    cross join lateral (
      select count(*) filter (where n.status = 'FAILED') as failed_7d,
             count(*) filter (where n.status = 'RETRY_PENDING') as retry_pending,
             count(*) filter (where n.status in ('PENDING', 'PROCESSING')) as pending,
             max(n.accepted_at) as last_accepted_at,
             (select n2.status from public.notification_deliveries n2 where n2.profile_id = st.id and n2.finished_at is not null
                 and n2.status in ('ACCEPTED_BY_PUSH_SERVICE', 'FAILED') order by n2.finished_at desc limit 1) as last_status,
             (select n2.finished_at from public.notification_deliveries n2 where n2.profile_id = st.id and n2.finished_at is not null
                 and n2.status in ('ACCEPTED_BY_PUSH_SERVICE', 'FAILED') order by n2.finished_at desc limit 1) as last_finished_at,
             (select coalesce(n2.last_status_code::text, n2.last_error) from public.notification_deliveries n2 where n2.profile_id = st.id and n2.status = 'FAILED'
               order by n2.finished_at desc nulls last limit 1) as last_error
        from public.notification_deliveries n where n.profile_id = st.id and n.created_at > now() - interval '7 days') dl
    cross join lateral (
      select count(*) as today_generated, count(*) filter (where g.push_status = 'NO_DEVICE') as today_no_device,
             coalesce(jsonb_agg(g.kind order by g.id), '[]'::jsonb) as today_kinds
        from public.attendance_reminder_log g where g.profile_id = st.id and g.attendance_date = c.today) lg
    cross join lateral (
      select bool_or(k.permission = 'denied' or k.push_state = 'blocked') as blocked_check,
             bool_or(k.audio_state = 'running') as audio_running,
             bool_or(k.audio_state = 'suspended') as audio_suspended,
             max(k.checked_at) as last_check_at
        from public.notification_client_checks k where k.profile_id = st.id and k.checked_at > now() - interval '14 days') ck
    cross join lateral (
      select exists (select 1 from public.leave_requests l where l.employee_id = st.id and l.status = 'APPROVED'
                       and c.today between l.start_date and l.end_date and l.leave_type = 'FULL_DAY') as on_leave) lv
    left join public.attendance_records ar on ar.profile_id = st.id and ar.attendance_date = c.today
  ),
  judged as (
    select r.*,
      -- a reminder that should exist by now and does not (Punch In / Punch Out, 10 minutes after it was due)
      (r.company_on and r.reminder_day and r.eff_enabled and not r.on_leave and (
         (now() > ((r.today + r.punch_in) at time zone 'Asia/Kolkata') + interval '10 minutes'
          and (r.punch_in_at is null or r.punch_in_at > ((r.today + r.punch_in) at time zone 'Asia/Kolkata') + interval '5 minutes')
          and not (r.today_kinds ? 'PUNCH_IN'))
         or
         (now() > ((r.today + r.punch_out) at time zone 'Asia/Kolkata') + interval '10 minutes'
          and r.punch_in_at is not null and r.punch_in_at < ((r.today + r.punch_out) at time zone 'Asia/Kolkata')
          and (r.punch_out_at is null or r.punch_out_at > ((r.today + r.punch_out) at time zone 'Asia/Kolkata') + interval '5 minutes')
          and not (r.today_kinds ? 'PUNCH_OUT')))) as reminder_missing,
      case
        when not r.company_on then 'COMPANY_PAUSED'
        when coalesce(r.pref_enabled, true) = false then 'REMINDERS_DISABLED'
        when p_push_configured is false then 'PUSH_UNAVAILABLE'
        when r.active_devices = 0 and coalesce(r.blocked_check, false) then 'NOTIFICATIONS_BLOCKED'
        when r.active_devices = 0 then 'DEVICE_NOT_REGISTERED'
        when r.last_status = 'FAILED' and r.last_finished_at > coalesce(r.last_success_at, '-infinity'::timestamptz) then 'DELIVERY_FAILED'
        when r.retry_pending > 0 then 'RETRY_PENDING'
        when r.last_success_at is null or r.last_success_at < now() - interval '14 days' then 'SETUP_REQUIRED'
        else 'READY'
      end as status
    from r
  )
  select jsonb_build_object(
    'profileId', j.id, 'name', j.full_name, 'role', j.role, 'designation', j.designation,
    'departmentId', j.base_dept, 'department', (select d.name from public.departments d where d.id = j.base_dept),
    'status', j.status,
    'remindersEnabled', coalesce(j.pref_enabled, true),
    'effective', jsonb_build_object('punchIn', private.hhmm(j.punch_in), 'lunch', private.hhmm(j.lunch), 'punchOut', private.hhmm(j.punch_out)),
    'activeDevices', j.active_devices, 'inactiveDevices', j.inactive_devices, 'expiredDevices', j.expired_devices,
    'lastAcceptedAt', greatest(j.last_success_at, j.last_accepted_at), 'lastFailureAt', j.last_failure_at, 'lastFailureCode', coalesce(j.last_error, j.last_failure_code),
    'failed7d', j.failed_7d, 'retryPending', j.retry_pending, 'pending', j.pending,
    'todayGenerated', j.today_generated, 'todayNoDevice', j.today_no_device, 'reminderMissing', j.reminder_missing,
    'noReminderToday', not (j.company_on and j.reminder_day) or j.on_leave or not j.eff_enabled,
    'onLeave', j.on_leave, 'attendanceStatus', j.attendance_status,
    'blockedReported', coalesce(j.blocked_check, false), 'lastDeviceCheckAt', j.last_check_at,
    'testConfirmedAt', j.test_confirmed_at,
    'soundStatus', case when j.sound_confirmed_at is not null or j.test_sound_heard then 'CONFIRMED'
                        when j.audio_running then 'AUDIO_ENABLED'
                        when j.audio_suspended then 'AUDIO_LOCKED'
                        else 'UNKNOWN' end)
  from judged j
$$;
revoke all on function private.notification_health_rows(boolean) from public, anon, authenticated;

create or replace function public.notification_health(p_department uuid default null, p_role text default null, p_issue text default null,
                                                      p_push_configured boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_all jsonb;
  v_rows jsonb;
  v_role text := nullif(upper(btrim(coalesce(p_role, ''))), '');
  v_issue text := nullif(upper(btrim(coalesce(p_issue, ''))), '');
  v_last_ok timestamptz;
  v_last public.notification_scheduler_runs;
  v_today date := private.office_today();
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR and the Super Admin see Notification Health.' using errcode = '42501';
  end if;
  if v_role is not null and v_role not in ('DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'VALIDATION_ERROR: Unknown role.' using errcode = 'P0001';
  end if;
  if v_issue is not null and v_issue not in ('READY', 'SETUP_REQUIRED', 'NOTIFICATIONS_BLOCKED', 'DEVICE_NOT_REGISTERED', 'PUSH_UNAVAILABLE',
                                             'DELIVERY_FAILED', 'RETRY_PENDING', 'REMINDERS_DISABLED', 'COMPANY_PAUSED', 'REMINDER_MISSING', 'SOUND_UNKNOWN') then
    raise exception 'VALIDATION_ERROR: Unknown issue.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(h.item), '[]'::jsonb) into v_all
    from private.notification_health_rows(p_push_configured) h
   where (p_department is null or (h.item ->> 'departmentId')::uuid = private.base_department(p_department))
     and (v_role is null or h.item ->> 'role' = v_role);
  select coalesce(jsonb_agg(x order by
           array_position(array['DELIVERY_FAILED', 'NOTIFICATIONS_BLOCKED', 'DEVICE_NOT_REGISTERED', 'PUSH_UNAVAILABLE', 'RETRY_PENDING', 'SETUP_REQUIRED',
                                 'REMINDERS_DISABLED', 'COMPANY_PAUSED', 'READY'], x ->> 'status'), x ->> 'name'), '[]'::jsonb) into v_rows
    from jsonb_array_elements(v_all) x
   where v_issue is null or x ->> 'status' = v_issue
      or (v_issue = 'REMINDER_MISSING' and (x ->> 'reminderMissing')::boolean)
      or (v_issue = 'SOUND_UNKNOWN' and x ->> 'soundStatus' in ('UNKNOWN', 'AUDIO_LOCKED'));
  select max(finished_at) into v_last_ok from public.notification_scheduler_runs where job = 'ATTENDANCE_REMINDERS' and ok;
  select * into v_last from public.notification_scheduler_runs where job = 'ATTENDANCE_REMINDERS' order by finished_at desc limit 1;
  perform private.write_audit('NOTIFICATION_HEALTH_VIEWED', 'notification_health', null, p_department, null,
    jsonb_build_object('role', v_role, 'issue', v_issue, 'rows', jsonb_array_length(v_rows)));
  return jsonb_build_object(
    'generatedAt', now(), 'today', v_today, 'pushConfigured', p_push_configured,
    'summary', (select jsonb_build_object(
        'eligible', count(*),
        'remindersEnabled', count(*) filter (where (x ->> 'remindersEnabled')::boolean),
        'remindersDisabled', count(*) filter (where not (x ->> 'remindersEnabled')::boolean),
        'withDevice', count(*) filter (where (x ->> 'activeDevices')::integer > 0),
        'withoutDevice', count(*) filter (where (x ->> 'activeDevices')::integer = 0),
        'recentFailures', count(*) filter (where (x ->> 'failed7d')::integer > 0),
        'reminderMissing', count(*) filter (where (x ->> 'reminderMissing')::boolean),
        'ready', count(*) filter (where x ->> 'status' = 'READY'),
        'byStatus', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select y ->> 'status' s, count(*) n from jsonb_array_elements(v_all) y group by 1) z))
      from jsonb_array_elements(v_all) x),
    'queue', (select jsonb_build_object(
        'pending', count(*) filter (where status in ('PENDING', 'PROCESSING')),
        'retryPending', count(*) filter (where status = 'RETRY_PENDING'),
        'accepted24h', count(*) filter (where status = 'ACCEPTED_BY_PUSH_SERVICE' and finished_at > now() - interval '24 hours'),
        'failed24h', count(*) filter (where status = 'FAILED' and finished_at > now() - interval '24 hours'),
        'expired24h', count(*) filter (where status = 'EXPIRED' and finished_at > now() - interval '24 hours'),
        'cancelled24h', count(*) filter (where status = 'CANCELLED' and finished_at > now() - interval '24 hours'))
      from public.notification_deliveries where created_at > now() - interval '7 days'),
    'todayReminders', (select jsonb_build_object('generated', count(*), 'bellWritten', count(*) filter (where notification_id is not null),
                                        'noDevice', count(*) filter (where push_status = 'NO_DEVICE'), 'pushOff', count(*) filter (where push_status = 'PUSH_OFF'))
                from public.attendance_reminder_log where attendance_date = v_today),
    'scheduler', jsonb_build_object(
        'lastSuccessAt', v_last_ok,
        'lastRunAt', v_last.finished_at, 'lastRunOk', v_last.ok, 'lastError', v_last.error, 'lastRunPushConfigured', v_last.push_configured,
        'runs24h', (select count(*) from public.notification_scheduler_runs where job = 'ATTENDANCE_REMINDERS' and finished_at > now() - interval '24 hours'),
        'failedRuns24h', (select count(*) from public.notification_scheduler_runs where job = 'ATTENDANCE_REMINDERS' and not ok and finished_at > now() - interval '24 hours'),
        'last24h', (select jsonb_build_object('attempted', coalesce(sum(attempted), 0), 'accepted', coalesce(sum(accepted), 0), 'failed', coalesce(sum(failed), 0),
                                              'retry', coalesce(sum(retry), 0), 'gone', coalesce(sum(gone), 0), 'noDevice', coalesce(sum(no_device), 0),
                                              'generated', coalesce(sum(generated), 0))
                      from public.notification_scheduler_runs where job = 'ATTENDANCE_REMINDERS' and finished_at > now() - interval '24 hours'),
        -- the cron runs every 5 minutes: more than 15 minutes without a good run is late, more than an hour is not running
        'health', case when v_last_ok is null then 'NOT_RUNNING' when v_last_ok > now() - interval '15 minutes' then 'HEALTHY'
                       when v_last_ok > now() - interval '60 minutes' then 'DELAYED' else 'NOT_RUNNING' end),
    'employees', v_rows);
end $$;
revoke all on function public.notification_health(uuid, text, text, boolean) from public, anon;
grant execute on function public.notification_health(uuid, text, text, boolean) to authenticated;

-- One employee: their devices (label, state, times, failure codes; never the address or keys), what their browsers reported, and the last
-- 30 deliveries. Audited.
create or replace function public.notification_health_employee(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR and the Super Admin see Notification Health.' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit('NOTIFICATION_HEALTH_VIEWED', 'profile', t.id, t.department_id, t.team_id, jsonb_build_object('detail', true));
  return jsonb_build_object(
    'profileId', t.id, 'name', t.full_name,
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label, 'active', s.active, 'createdAt', s.created_at,
                  'lastSuccessAt', s.last_success_at, 'lastFailureAt', s.last_failure_at, 'lastFailureCode', s.last_failure_code,
                  'failureCount', s.failure_count, 'deactivatedReason', s.deactivated_reason, 'testConfirmedAt', s.test_confirmed_at) order by s.created_at desc), '[]'::jsonb)
                  from public.push_subscriptions s where s.profile_id = t.id),
    'browsers', (select coalesce(jsonb_agg(jsonb_build_object('label', k.label, 'permission', k.permission, 'pushState', k.push_state,
                   'audioState', k.audio_state, 'standalone', k.standalone, 'checkedAt', k.checked_at) order by k.checked_at desc), '[]'::jsonb)
                   from public.notification_client_checks k where k.profile_id = t.id),
    'deliveries', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'reminderKind', g.kind, 'step', g.step,
                     'device', n.device_label, 'status', n.status, 'attempts', n.attempts, 'statusCode', n.last_status_code, 'error', n.last_error,
                     'createdAt', n.created_at, 'acceptedAt', n.accepted_at, 'finishedAt', n.finished_at) order by n.created_at desc), '[]'::jsonb)
                     from (select * from public.notification_deliveries where profile_id = t.id order by created_at desc limit 30) n
                     left join public.attendance_reminder_log g on g.id = n.reminder_id),
    'reminders', (select coalesce(jsonb_agg(jsonb_build_object('date', g.attendance_date, 'kind', g.kind, 'step', g.step, 'dueAt', g.due_at,
                    'sentAt', g.sent_at, 'pushStatus', g.push_status, 'devices', g.devices) order by g.id desc), '[]'::jsonb)
                    from (select * from public.attendance_reminder_log where profile_id = t.id order by id desc limit 20) g));
end $$;
revoke all on function public.notification_health_employee(uuid) from public, anon;
grant execute on function public.notification_health_employee(uuid) to authenticated;

notify pgrst, 'reload schema';
