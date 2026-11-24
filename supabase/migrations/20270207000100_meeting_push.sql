-- =============================================================================
-- Meeting notifications on phones (Task 05; follows 20270126000200_notification_reliability.sql and 20270131000200_company_notice_board.sql).
--
-- Until now meeting notifications (invited, moved, cancelled, reminders, approvals, reports) were written to the bell only: no meeting
-- notification ever reached a phone, the Managing Director's included. Now:
-- * Each meeting notification a person receives in the CRM that needs their attention is also queued as a push to each of their active
--   devices (kind MEETING), sent by the existing delivery worker (retries, dead-device clean-up, expiry). Information-only types (an
--   answer to an invitation, presence, sync problems...) stay in the bell. One delivery per notification and device, so nothing is sent
--   twice. Nobody is told about their own action. A newer notice about the same meeting replaces an older one still waiting.
-- * The lock screen shows a fixed label, the meeting's title and its time only, never the agenda, minutes, participants or who asked.
-- * Tapping it opens that meeting (/?open=meeting&id=...).
-- * Reminders: 24 hours and 1 hour before (as before; guests booked at short notice still get the 1-hour e-mail), plus 15 minutes before and at the start. Each once per start time, so a rescheduled
--   meeting is reminded again and a cancelled one is not. The 5-minute scheduled run creates them (server/app.ts).
-- Who is notified does not change: the host, the organiser and the invitees, and whoever must approve (the existing rules).
-- Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

-- 1. The queue takes meeting pushes, one per notification and device
alter table public.notification_deliveries drop constraint if exists notification_deliveries_kind_check;
alter table public.notification_deliveries add constraint notification_deliveries_kind_check
  check (kind in ('ATTENDANCE_REMINDER', 'TEST', 'SA_ATTENDANCE', 'COMPANY_NOTICE', 'MEETING'));
alter table public.notification_deliveries add column if not exists notification_id uuid references public.notifications (id) on delete set null;
create unique index if not exists notification_deliveries_notification_uidx
  on public.notification_deliveries (notification_id, subscription_id) where notification_id is not null;

-- 2. Reminders 15 minutes before and at the start
alter table public.meeting_reminders drop constraint if exists meeting_reminders_kind_check;
alter table public.meeting_reminders add constraint meeting_reminders_kind_check check (kind in ('24H', '1H', '15M', 'START'));

-- 3. Which meeting notifications go to the phone (the ones that need the person's attention)
create or replace function private.meeting_push_type(p_type text)
returns boolean language sql immutable set search_path = '' as $$
  select p_type in ('MEETING_INVITED', 'MEETING_RESCHEDULED', 'MEETING_MOVED', 'MEETING_CANCELLED', 'MEETING_REMINDER',
                    'MEETING_REQUESTED', 'MEETING_APPROVED', 'MEETING_DECLINED', 'MEETING_PROPOSED', 'MEETING_SCHEDULED',
                    'MEETING_QUEUE_SCHEDULED', 'MEETING_BOOKED', 'MEETING_SUMMARY_SUBMITTED', 'MEETING_SUMMARY_REVISED',
                    'MEETING_SUMMARY_PENDING', 'MEETING_SUMMARY_OVERDUE')
$$;
revoke all on function private.meeting_push_type(text) from public, anon, authenticated;

-- Queue the push of one meeting notification to the recipient's active devices. Returns how many deliveries were created.
create or replace function private.meeting_push_queue(n public.notifications)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_meeting uuid;
  m public.meetings;
  v_starts timestamptz;
  v_label text;
  v_title text;
  v_body text;
  v_tag text;
  v_expires timestamptz;
  v_n integer;
begin
  if n.id is null or not private.meeting_push_type(n.type) then
    return 0;
  end if;
  -- nobody is told about their own action (some meeting notices are written directly, not through private.notify)
  if n.actor_id is not null and n.actor_id = n.recipient_id then
    return 0;
  end if;
  if not exists (select 1 from public.profiles p where p.id = n.recipient_id and p.status = 'ACTIVE') then
    return 0;
  end if;
  v_meeting := coalesce(case when (n.data ->> 'meetingId') ~ '^[0-9a-f-]{36}$' then (n.data ->> 'meetingId')::uuid end,
                        case when n.entity_type = 'meeting' then n.entity_id end);
  if v_meeting is not null then
    select * into m from public.meetings where id = v_meeting;
  end if;
  begin
    v_starts := nullif(n.data ->> 'startsAt', '')::timestamptz;
  exception when others then
    v_starts := null;
  end;
  v_starts := case when n.type = 'MEETING_PROPOSED' then coalesce(m.proposed_starts_at, v_starts, m.starts_at)
                   else coalesce(v_starts, m.starts_at) end;
  -- the lock screen: a fixed label and the meeting's title and time; never the agenda, minutes, participants or who asked
  -- (the CRM notification's own title can name a requester, a guest or the host)
  v_label := case n.type
    when 'MEETING_INVITED' then 'Meeting invitation'
    when 'MEETING_RESCHEDULED' then 'Meeting moved'
    when 'MEETING_MOVED' then 'Meeting moved'
    when 'MEETING_CANCELLED' then 'Meeting cancelled'
    when 'MEETING_REQUESTED' then 'Meeting request'
    when 'MEETING_APPROVED' then 'Meeting approved'
    when 'MEETING_DECLINED' then 'Meeting declined'
    when 'MEETING_PROPOSED' then 'Another time proposed'
    when 'MEETING_SCHEDULED' then 'Meeting scheduled'
    when 'MEETING_QUEUE_SCHEDULED' then 'Meeting scheduled'
    when 'MEETING_BOOKED' then 'New booking'
    when 'MEETING_SUMMARY_SUBMITTED' then 'Meeting summary submitted'
    when 'MEETING_SUMMARY_REVISED' then 'Meeting summary revised'
    when 'MEETING_SUMMARY_PENDING' then 'Meeting summary due'
    when 'MEETING_SUMMARY_OVERDUE' then 'Meeting summary overdue'
    else 'Meeting' end;
  v_title := case
    when n.type = 'MEETING_REMINDER' then n.title  -- "In 15 minutes: <meeting title>" (mtg_enqueue_reminders)
    when m.id is not null and nullif(btrim(m.title), '') is not null then v_label || ': ' || m.title
    else v_label end;
  v_body := case when v_starts is not null then to_char(v_starts at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI AM') || ' (IST)'
                 else 'Open the CRM to see the details.' end;
  -- a reminder or a change is useless long after the meeting: it expires an hour after the start (never sooner than 30 minutes from
  -- now, so retries can run); a summary notice (the meeting is over) a day after it was queued
  v_expires := case when n.type like 'MEETING_SUMMARY%' or v_starts is null then now() + interval '24 hours'
                    else greatest(now() + interval '30 minutes', least(now() + interval '24 hours', v_starts + interval '1 hour')) end;
  v_tag := left('meeting-' || coalesce(v_meeting::text, n.id::text), 80);
  -- a newer notice about the same meeting replaces an older one still waiting (a retried reminder never covers "cancelled");
  -- and this person's meeting pushes past their expiry are closed (they are not sent when push is not configured)
  update public.notification_deliveries d
     set status = case when d.expires_at <= now() then 'EXPIRED' else 'CANCELLED' end,
         last_error = case when d.expires_at <= now() then 'EXPIRED' else 'SUPERSEDED' end,
         finished_at = now(), updated_at = now()
   where d.kind = 'MEETING' and d.profile_id = n.recipient_id and d.status in ('PENDING', 'RETRY_PENDING')
     and (d.lease_until is null or d.lease_until < now())
     and d.notification_id is distinct from n.id
     and (d.tag = v_tag or d.expires_at <= now());
  insert into public.notification_deliveries (kind, notification_id, profile_id, subscription_id, device_label, title, body, tag, url, expires_at, next_attempt_at)
  select 'MEETING', n.id, n.recipient_id, s.id, s.label, left(v_title, 200), left(v_body, 500), v_tag,
         case when v_meeting is not null then '/?open=meeting&id=' || v_meeting else '/?open=meeting' end,
         v_expires, now()
    from public.push_subscriptions s
   where s.profile_id = n.recipient_id and s.active
  on conflict (notification_id, subscription_id) where notification_id is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.meeting_push_queue(public.notifications) from public, anon, authenticated;

-- every meeting notification, whichever function wrote it, is considered (a push failure never stops the notification itself)
create or replace function private.notifications_meeting_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.meeting_push_queue(new);
  exception when others then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('MEETING_PUSH_ERROR', 'notification', new.id, jsonb_build_object('error', left(sqlerrm, 300), 'type', new.type));
  end;
  return new;
end $$;
revoke all on function private.notifications_meeting_push() from public, anon, authenticated;
drop trigger if exists notifications_meeting_push on public.notifications;
create trigger notifications_meeting_push after insert on public.notifications
  for each row when (new.type like 'MEETING%') execute function private.notifications_meeting_push();

-- 4. Reminders: 24 hours, 1 hour, 15 minutes before and at the start; in the CRM for colleagues (and so on their phones), by e-mail for
--    guests (24 hours and 1 hour only, as before). Each once per start time.
create or replace function public.mtg_enqueue_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r public.meetings;
  k text;
  v_n integer := 0;
begin
  for r in select * from public.meetings m
            where m.status = 'SCHEDULED' and m.starts_at > now() - interval '5 minutes' and m.starts_at <= now() + interval '24 hours' loop
    k := case when r.starts_at <= now() + interval '5 minutes' then 'START'
              when r.starts_at <= now() + interval '15 minutes' then '15M'
              when r.starts_at <= now() + interval '1 hour' then '1H'
              else '24H' end;
    -- a meeting booked within the hour gets no "in 24 hours" reminder afterwards
    insert into public.meeting_reminders (meeting_id, kind, starts_at) values (r.id, k, r.starts_at) on conflict do nothing;
    if found then
      v_n := v_n + 1;
      perform private.mtg_notify_staff(r, 'MEETING_REMINDER',
        case k when 'START' then 'Starting now: ' when '15M' then 'In 15 minutes: ' when '1H' then 'Starting soon: ' else 'Tomorrow: ' end || r.title,
        private.mtg_when(r.starts_at, r.timezone) || coalesce('. Join: ' || r.meet_link, '') || '.');
      if k in ('24H', '1H') then
        perform private.mtg_mail_externals(r, 'REMINDER_' || k);
      elsif k = '15M' and not exists (select 1 from public.meeting_reminders x where x.meeting_id = r.id and x.kind = '1H' and x.starts_at = r.starts_at) then
        -- booked at short notice: guests still get the "starting soon" e-mail they got before
        perform private.mtg_mail_externals(r, 'REMINDER_1H');
      end if;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.mtg_enqueue_reminders() from public, anon, authenticated;
grant execute on function public.mtg_enqueue_reminders() to service_role;
