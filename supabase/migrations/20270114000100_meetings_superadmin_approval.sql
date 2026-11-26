-- =============================================================================
-- Meetings with the CEO: ONLY the Super Admin approves, rejects or reschedules
-- =============================================================================
-- Super Admin and CEO are one account (profiles.role = 'SUPER_ADMIN'); there is no separate CEO role. This migration tightens the existing
-- "Ask the CEO for time" flow of the Meetings engine (20270101000500, 20270113000100). It adds no table and no second permission system.
--
-- Before: the CEO's delegates could see, approve, propose, decline, move, cancel and even book the CEO's time directly (no request), and a
-- decline needed no reason. After, for every meeting whose host is a Super Admin:
--   * only a Super Admin decides (approve / reject / propose another time), moves, cancels or completes it; delegates, Admin, HR, Department
--     Heads, Team Leads, Team Members, Business Associates, Technical Consultants, Accounts and everybody else are refused (42501 = HTTP 403)
--   * anybody else booking the CEO's time makes a REQUEST (the delegate shortcut is gone)
--   * a rejection needs a reason, and so does moving or cancelling someone's meeting; the employee sees the reason
--   * the employee sees their own requests only; they may withdraw a pending request or ask for another time (which goes back to "requested")
--   * the previous and the new time, the reason, who and when are saved on the meeting and in the append-only history
--   * a trigger refuses any status / time change that a non-Super Admin should not cause, even from a future function (defence in depth)
-- Meetings of other hosts (a colleague's booking link, demos, interviews, HR meetings) work as before.
-- Safe to run twice: additive columns, "create or replace", no data is deleted or rewritten except the one-time backfill of the new
-- columns from the history.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. What a reschedule records, and the employee's extra message
-- ---------------------------------------------------------------------------
alter table public.meetings add column if not exists request_message text;
alter table public.meetings add column if not exists previous_starts_at timestamptz;
alter table public.meetings add column if not exists previous_ends_at timestamptz;
alter table public.meetings add column if not exists rescheduled_at timestamptz;
alter table public.meetings add column if not exists rescheduled_by uuid references public.profiles (id) on delete set null;
alter table public.meetings add column if not exists reschedule_reason text;
alter table public.meetings add column if not exists reschedule_count integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meetings_request_message_len') then
    alter table public.meetings add constraint meetings_request_message_len check (request_message is null or length(request_message) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meetings_reschedule_reason_len') then
    alter table public.meetings add constraint meetings_reschedule_reason_len check (reschedule_reason is null or length(reschedule_reason) <= 1000);
  end if;
end $$;
create index if not exists meetings_ceo_requests_idx on public.meetings (created_at desc) where kind = 'CEO_MEETING';

-- ---------------------------------------------------------------------------
-- 2. Who may do what (the one place the rule lives)
-- ---------------------------------------------------------------------------
-- the host is a Super Admin (the CEO): by role alone, so the rule does not lapse if the account is switched off
create or replace function private.mtg_host_is_sa(p_host uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_host and p.role = 'SUPER_ADMIN')
$$;

-- see a meeting: its host, whoever booked it, an invited colleague, a host's delegate (never for the CEO's), a Super Admin for CEO requests
create or replace function private.mtg_can_view(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (
    m.host_id = p_profile or m.created_by = p_profile
    or exists (select 1 from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id = p_profile)
    or (not private.mtg_host_is_sa(m.host_id) and private.mtg_is_delegate(m.host_id, p_profile))
    or (m.kind = 'CEO_MEETING' and private.mtg_is_ceo(p_profile)))
$$;

-- change a meeting (move, cancel, mark done). The CEO's meetings: a Super Admin only. (The one who asked can only withdraw a pending request
-- or ask for another time: those are checked in mtg_cancel / mtg_reschedule.) Everybody else's meetings: as before.
create or replace function private.mtg_can_manage(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (
    case when private.mtg_host_is_sa(m.host_id)
         then private.mtg_is_ceo(p_profile)
         else m.host_id = p_profile or m.created_by = p_profile or private.mtg_is_delegate(m.host_id, p_profile) end)
$$;

-- decide a request for the host's time. The CEO's time: a Super Admin only (never a delegate, an Admin, HR or the one asking).
create or replace function private.mtg_can_decide(m public.meetings, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (
    case when private.mtg_host_is_sa(m.host_id)
         then private.mtg_is_ceo(p_profile)
         else m.host_id = p_profile or private.mtg_is_delegate(m.host_id, p_profile) end)
$$;

revoke all on function private.mtg_host_is_sa(uuid), private.mtg_can_view(public.meetings, uuid), private.mtg_can_manage(public.meetings, uuid),
  private.mtg_can_decide(public.meetings, uuid) from public, anon, authenticated;

-- a request waiting for a decision: the CEO is told (delegates are not: they cannot decide)
create or replace function private.mtg_notify_deciders(m public.meetings, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  perform private.notify_once(m.host_id, 'MEETING_REQUESTED', p_title, p_body, 'meeting', m.id, jsonb_build_object('meetingId', m.id), 'urgent');
  if not private.mtg_host_is_sa(m.host_id) then
    for r in select d.delegate_id from public.meeting_delegates d join public.profiles p on p.id = d.delegate_id and p.status = 'ACTIVE'
              where d.host_id = m.host_id loop
      perform private.notify_once(r.delegate_id, 'MEETING_REQUESTED', p_title, p_body, 'meeting', m.id, jsonb_build_object('meetingId', m.id), 'urgent');
    end loop;
  end if;
end $$;
revoke all on function private.mtg_notify_deciders(public.meetings, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Defence in depth: a trigger that refuses what a non-Super Admin must never cause on a CEO meeting
-- ---------------------------------------------------------------------------
-- The functions below already check the role. This trigger stays true even if a later function forgets to: with a signed-in user's login
-- (auth.uid() set; the server's service role and the database owner have none), a CEO meeting cannot be created already scheduled, approved,
-- rejected, moved or cancelled by anyone but a Super Admin. Allowed for the one who asked: withdraw a pending request, ask for another time
-- (back to "requested"), and answer a proposed time.
create or replace function private.tg_meetings_ceo_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or private.mtg_is_ceo(v_uid) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.kind = 'CEO_MEETING' and private.mtg_host_is_sa(new.host_id) and new.status <> 'REQUESTED' then
      raise exception 'FORBIDDEN: Only the Super Admin (CEO) can schedule a meeting with the CEO. Send a request instead.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.kind = 'CEO_MEETING' and private.mtg_host_is_sa(old.host_id)
     and (new.status is distinct from old.status or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
          or new.decided_by is distinct from old.decided_by) then
    if not (
         -- withdraw a pending request
         (old.created_by = v_uid and old.status in ('REQUESTED', 'PROPOSED') and new.status = 'CANCELLED')
         -- ask for another time: the meeting goes back to "requested"; nobody's decision is touched
         or (old.created_by = v_uid and old.status in ('REQUESTED', 'PROPOSED', 'SCHEDULED') and new.status = 'REQUESTED'
             and new.decided_by is not distinct from old.decided_by)
         -- answer the time the CEO proposed
         or (old.created_by = v_uid and old.status = 'PROPOSED' and new.status in ('SCHEDULED', 'DECLINED')
             and new.decided_by is not distinct from old.decided_by)) then
      raise exception 'FORBIDDEN: Only the Super Admin (CEO) can approve, reject, reschedule or cancel a meeting with the CEO.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_meetings_ceo_guard() from public, anon, authenticated;
drop trigger if exists meetings_ceo_guard on public.meetings;
create trigger meetings_ceo_guard before insert or update on public.meetings for each row execute function private.tg_meetings_ceo_guard();

-- ---------------------------------------------------------------------------
-- 4. What the screens read
-- ---------------------------------------------------------------------------
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
    'googleEventId', m.google_event_id, 'version', m.version, 'createdAt', m.created_at, 'updatedAt', m.updated_at)
  || jsonb_build_object(
    'canManage', m.source_type is null and private.mtg_can_manage(m, p_viewer),
    'canDecide', m.status = 'REQUESTED' and private.mtg_can_decide(m, p_viewer),
    'canAnswerProposal', m.status = 'PROPOSED' and (m.created_by = p_viewer or (m.created_by is null and private.mtg_can_manage(m, p_viewer))),
    -- the one who asked for the CEO's time: withdraw a pending request / ask for another time (never decide)
    'canWithdraw', m.kind = 'CEO_MEETING' and m.source_type is null and m.created_by = p_viewer and m.status in ('REQUESTED', 'PROPOSED')
                   and not private.mtg_can_decide(m, p_viewer),
    'canRequestChange', private.mtg_host_is_sa(m.host_id) and m.source_type is null and m.created_by = p_viewer
                        and m.status in ('REQUESTED', 'PROPOSED', 'SCHEDULED') and not private.mtg_can_decide(m, p_viewer),
    'myResponse', (select a.response from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id = p_viewer))
  || jsonb_build_object(
    -- the CEO's requests: who asked, what for, and what was decided
    'requestMessage', m.request_message,
    'createdByDepartment', case when m.created_by is null then null else private.employee_snapshot(m.created_by) ->> 'department' end,
    'createdByDesignation', case when m.created_by is null then null else private.employee_snapshot(m.created_by) ->> 'designation' end,
    'rejectionReason', case when m.status = 'DECLINED' then m.decision_note end,
    'previousStartsAt', m.previous_starts_at, 'previousEndsAt', m.previous_ends_at,
    'rescheduledAt', m.rescheduled_at, 'rescheduledBy', m.rescheduled_by, 'rescheduledByName', rb.full_name,
    'rescheduleReason', m.reschedule_reason, 'rescheduleCount', m.reschedule_count,
    'attendees', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'profileId', a.profile_id, 'name', coalesce(p.full_name, a.name),
                    'email', coalesce(p.email, a.email), 'phone', a.phone, 'role', a.role, 'response', a.response) order by a.created_at)
                    from public.meeting_attendees a left join public.profiles p on p.id = a.profile_id where a.meeting_id = m.id), '[]'::jsonb))
    from public.profiles h
    left join public.profiles c on c.id = m.created_by
    left join public.profiles dcd on dcd.id = m.decided_by
    left join public.profiles rb on rb.id = m.rescheduled_by
   where h.id = m.host_id
$$;
revoke all on function private.mtg_json(public.meetings, uuid) from public, anon, authenticated;

-- requests waiting for a decision: the Super Admin's (nobody else's)
create or replace function public.mtg_pending_approvals()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  return coalesce((select jsonb_agg(private.mtg_json(m, me.id) order by m.starts_at) from public.meetings m
     where m.status = 'REQUESTED' and private.mtg_can_decide(m, me.id)), '[]'::jsonb);
end $$;

-- The meeting requests with the CEO, in the sections of the dashboard. A Super Admin sees every employee's request; everybody else only
-- their own. Sections: PENDING (waiting, or another time proposed), APPROVED (confirmed, never moved), REJECTED, RESCHEDULED (confirmed after
-- a move), ALL (the whole history, cancelled ones too). Newest request first.
create or replace function public.mtg_ceo_requests(p_section text default 'ALL', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  v_sa boolean := private.mtg_is_ceo(me.id);
  v_sec text := upper(coalesce(nullif(btrim(p_section), ''), 'ALL'));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_counts jsonb;
  v_items jsonb := '[]'::jsonb;
  r public.meetings;
begin
  if v_sec not in ('PENDING', 'APPROVED', 'REJECTED', 'RESCHEDULED', 'ALL') then
    raise exception 'VALIDATION_ERROR: Choose PENDING, APPROVED, REJECTED, RESCHEDULED or ALL.' using errcode = '22023';
  end if;
  select jsonb_build_object(
           'pending', count(*) filter (where m.status in ('REQUESTED', 'PROPOSED')),
           'approved', count(*) filter (where m.status in ('SCHEDULED', 'COMPLETED') and m.reschedule_count = 0),
           'rejected', count(*) filter (where m.status = 'DECLINED'),
           'rescheduled', count(*) filter (where m.status in ('SCHEDULED', 'COMPLETED') and m.reschedule_count > 0),
           'all', count(*))
    into v_counts
    from public.meetings m
   where m.kind = 'CEO_MEETING' and m.source_type is null and (v_sa or m.created_by = me.id);
  for r in select m.* from public.meetings m
            where m.kind = 'CEO_MEETING' and m.source_type is null and (v_sa or m.created_by = me.id)
              and case v_sec
                    when 'PENDING' then m.status in ('REQUESTED', 'PROPOSED')
                    when 'APPROVED' then m.status in ('SCHEDULED', 'COMPLETED') and m.reschedule_count = 0
                    when 'REJECTED' then m.status = 'DECLINED'
                    when 'RESCHEDULED' then m.status in ('SCHEDULED', 'COMPLETED') and m.reschedule_count > 0
                    else true end
            order by m.created_at desc, m.id
            limit v_limit offset v_offset loop
    v_items := v_items || jsonb_build_array(private.mtg_json(r, me.id));
  end loop;
  return jsonb_build_object('section', v_sec, 'isSuperAdmin', v_sa, 'counts', v_counts, 'items', v_items, 'limit', v_limit, 'offset', v_offset);
end $$;
revoke all on function public.mtg_ceo_requests(text, integer, integer) from public, anon;
grant execute on function public.mtg_ceo_requests(text, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Asking for the CEO's time (every signed-in employee), booking
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
  -- the CEO's time is asked for, never taken: everybody but the CEO themselves sends a request (no shortcut for delegates)
  v_request := private.mtg_is_ceo(v_host) and v_host <> me.id;
  if v_request and length(btrim(coalesce(p ->> 'description', ''))) < 5 then
    raise exception 'VALIDATION_ERROR: Describe the agenda or purpose of the meeting (at least 5 characters).' using errcode = '22023';
  end if;
  if length(coalesce(p ->> 'message', '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The message can have at most 2000 characters.' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- 6. Approve / reject / propose another time (Super Admin only)
-- ---------------------------------------------------------------------------
create or replace function public.mtg_decide(p_id uuid, p_decision text, p_note text default null, p_starts_at timestamptz default null,
  p_ends_at timestamptz default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_was text;
begin
  -- who may decide is checked first, on the stored meeting and the signed-in account's own role: never on anything the caller sends
  select * into m from public.meetings where id = p_id;
  if m.id is not null and private.mtg_host_is_sa(m.host_id) and not private.mtg_can_decide(m, me.id) then
    raise exception 'FORBIDDEN: Only the Super Admin (CEO) can approve, reject or reschedule a meeting request with the CEO.' using errcode = '42501';
  end if;
  m := private.mtg_for_update(p_id, p_version);
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if not private.mtg_can_decide(m, me.id) then
    raise exception 'FORBIDDEN: Only the person asked for the meeting (or their delegate) can decide.' using errcode = '42501';
  end if;
  if m.status <> 'REQUESTED' then
    raise exception 'CONFLICT: This request was already answered.' using errcode = 'P0001';
  end if;
  v_was := m.status;
  -- a rejection of a request for the CEO's time always says why: the employee reads it
  if p_decision = 'DECLINE' and private.mtg_host_is_sa(m.host_id) and v_note is null then
    raise exception 'VALIDATION_ERROR: Give the reason for rejecting the request. The employee will see it.' using errcode = '22023';
  end if;
  perform private.mtg_lock_host(m.host_id);
  if p_decision = 'APPROVE' then
    if private.mtg_host_conflict(m.host_id, m.starts_at, m.ends_at, m.id) is not null
       and exists (select 1 from public.meetings x where x.id = private.mtg_host_conflict(m.host_id, m.starts_at, m.ends_at, m.id) and x.status = 'SCHEDULED') then
      raise exception 'CONFLICT: Another meeting is already scheduled at that time. Propose another time instead.' using errcode = 'P0001';
    end if;
    update public.meetings set status = 'SCHEDULED', decided_by = me.id, decided_at = now(), decision_note = v_note, version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'APPROVED', v_note,
      jsonb_build_object('fromStatus', v_was, 'toStatus', m.status, 'startsAt', m.starts_at, 'endsAt', m.ends_at, 'decidedBy', me.id));
    perform private.mtg_notify_staff(m, 'MEETING_APPROVED', 'Meeting approved: ' || m.title,
      private.mtg_when(m.starts_at, m.timezone) || coalesce('. ' || v_note, '') || '.', me.id);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  elsif p_decision = 'DECLINE' then
    update public.meetings set status = 'DECLINED', decided_by = me.id, decided_at = now(), decision_note = v_note, version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'DECLINED', v_note, jsonb_build_object('fromStatus', v_was, 'toStatus', m.status, 'decidedBy', me.id));
    perform private.mtg_notify_staff(m, 'MEETING_DECLINED', 'Meeting request rejected: ' || m.title, coalesce(v_note, 'No reason given.'), me.id);
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
    perform private.mtg_event(m.id, 'PROPOSED', v_note,
      jsonb_build_object('fromStatus', v_was, 'toStatus', m.status, 'startsAt', p_starts_at, 'endsAt', p_ends_at, 'decidedBy', me.id));
    perform private.mtg_notify_staff(m, 'MEETING_PROPOSED', 'Another time proposed: ' || m.title,
      private.mtg_when(p_starts_at, m.timezone) || '. Accept it or decline.', me.id, 'urgent');
    perform private.mtg_mail_externals(m, 'PROPOSED');
  else
    raise exception 'VALIDATION_ERROR: Decide APPROVE, DECLINE or PROPOSE.' using errcode = '22023';
  end if;
  perform private.write_audit('MEETING_' || p_decision || 'D', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('host', m.host_id, 'note', v_note, 'fromStatus', v_was, 'toStatus', m.status));
  return private.mtg_json(m, me.id);
end $$;

-- the one who asked answers a proposed time: a move the CEO chose, so it counts as a reschedule
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
           previous_starts_at = starts_at, previous_ends_at = ends_at, rescheduled_at = now(), rescheduled_by = m.decided_by,
           reschedule_reason = m.decision_note, reschedule_count = reschedule_count + 1,
           proposed_starts_at = null, proposed_ends_at = null, version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'PROPOSAL_ACCEPTED', null, jsonb_build_object('fromStatus', 'PROPOSED', 'toStatus', m.status,
      'from', m.previous_starts_at, 'to', m.starts_at));
    perform private.mtg_notify_staff(m, 'MEETING_APPROVED', 'Meeting confirmed: ' || m.title, private.mtg_when(m.starts_at, m.timezone) || '.', p_actor);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  else
    update public.meetings set status = 'DECLINED', version = version + 1 where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'PROPOSAL_DECLINED', null, jsonb_build_object('fromStatus', 'PROPOSED', 'toStatus', m.status));
    perform private.mtg_notify_staff(m, 'MEETING_DECLINED', 'Proposed time declined: ' || m.title, 'The request is closed.', p_actor);
  end if;
  return m;
end $$;
revoke all on function private.mtg_answer_proposal(public.meetings, boolean, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reschedule and cancel
-- ---------------------------------------------------------------------------
-- A Super Admin moves a pending or confirmed meeting (reason required); the employee sees the new time and the reason. The one who asked
-- can only ask for another time: the meeting goes back to "requested". Other hosts' meetings: as before.
create or replace function public.mtg_reschedule(p_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_note text default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
  v_old timestamptz;
  v_old_end timestamptz;
  v_was text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_sa_host boolean;
  v_decider boolean;
  v_request boolean;
begin
  select * into m from public.meetings where id = p_id;
  -- the CEO's meetings: only a Super Admin moves them (the one who asked may ask for another time): checked before anything is revealed
  if m.id is not null and private.mtg_host_is_sa(m.host_id) and not (private.mtg_can_decide(m, me.id) or m.created_by = me.id) then
    raise exception 'FORBIDDEN: Only the Super Admin (CEO) can reschedule a meeting with the CEO.' using errcode = '42501';
  end if;
  m := private.mtg_for_update(p_id, p_version);
  v_old := m.starts_at;
  v_old_end := m.ends_at;
  v_was := m.status;
  v_sa_host := private.mtg_host_is_sa(m.host_id);
  v_decider := private.mtg_can_decide(m, me.id);
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if m.source_type is not null then
    raise exception 'CONFLICT: This meeting is managed in its own page (demo, interview or HR meeting). Change it there.' using errcode = 'P0001';
  end if;
  if not (case when v_sa_host then v_decider or m.created_by = me.id else private.mtg_can_manage(m, me.id) end) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can move it.' using errcode = '42501';
  end if;
  if m.status not in ('REQUESTED', 'PROPOSED', 'SCHEDULED') then
    raise exception 'CONFLICT: A % meeting cannot be moved.', lower(m.status) using errcode = 'P0001';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_starts_at < now() - interval '5 minutes' then
    raise exception 'VALIDATION_ERROR: Pick a future time that ends after it starts.' using errcode = '22023';
  end if;
  -- the Super Admin moving someone's request always says why: the employee reads it
  if v_sa_host and v_decider and m.created_by is distinct from me.id and v_note is null then
    raise exception 'VALIDATION_ERROR: Give the reason for rescheduling. The employee will see it.' using errcode = '22023';
  end if;
  perform private.mtg_lock_host(m.host_id);
  if private.mtg_host_conflict(m.host_id, p_starts_at, p_ends_at, m.id) is not null then
    raise exception 'CONFLICT: The host already has a meeting at that time. Pick another time.' using errcode = 'P0001';
  end if;
  -- the one asking (or anybody who is not the CEO, on the CEO's time) needs approval again; others' meetings keep their rule
  v_request := (v_sa_host and not v_decider) or (not v_sa_host and m.requires_approval and not v_decider);
  if v_request then
    update public.meetings set starts_at = p_starts_at, ends_at = p_ends_at, proposed_starts_at = null, proposed_ends_at = null,
           status = 'REQUESTED', version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, case when v_sa_host then 'CHANGE_REQUESTED' else 'RESCHEDULED' end, v_note,
      jsonb_build_object('from', v_old, 'to', p_starts_at, 'fromStatus', v_was, 'toStatus', m.status));
    perform private.mtg_notify_deciders(m, 'Meeting request moved by ' || me.full_name, m.title || ' — now ' || private.mtg_when(m.starts_at, m.timezone) || '.');
  else
    update public.meetings set starts_at = p_starts_at, ends_at = p_ends_at, proposed_starts_at = null, proposed_ends_at = null,
           status = 'SCHEDULED', version = version + 1,
           previous_starts_at = v_old, previous_ends_at = v_old_end, rescheduled_at = now(), rescheduled_by = me.id,
           reschedule_reason = v_note, reschedule_count = reschedule_count + 1,
           -- moving a pending request confirms it at the new time: the Super Admin is its decider
           decided_by = case when v_was = 'REQUESTED' and v_sa_host then me.id else decided_by end,
           decided_at = case when v_was = 'REQUESTED' and v_sa_host then now() else decided_at end
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'RESCHEDULED', v_note,
      jsonb_build_object('from', v_old, 'to', p_starts_at, 'fromEnd', v_old_end, 'toEnd', p_ends_at, 'fromStatus', v_was, 'toStatus', m.status,
                         'rescheduledBy', me.id));
    perform private.mtg_notify_staff(m, 'MEETING_RESCHEDULED', 'Meeting moved: ' || m.title,
      'Now ' || private.mtg_when(m.starts_at, m.timezone) || ' (was ' || private.mtg_when(v_old, m.timezone) || ')' || coalesce('. Reason: ' || v_note, '') || '.', me.id);
    perform private.mtg_mail_externals(m, 'RESCHEDULED');
  end if;
  perform private.write_audit('MEETING_RESCHEDULED', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('from', v_old, 'to', p_starts_at, 'reason', v_note, 'fromStatus', v_was, 'toStatus', m.status));
  return private.mtg_json(m, me.id);
end $$;

-- A Super Admin cancels a pending or confirmed meeting (reason required when it is someone's request); the one who asked can only withdraw a
-- request that is still pending. Other hosts' meetings: as before.
create or replace function public.mtg_cancel(p_id uuid, p_reason text default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_was text;
  v_sa_host boolean;
  v_decider boolean;
begin
  select * into m from public.meetings where id = p_id;
  if m.id is not null and private.mtg_host_is_sa(m.host_id)
     and not (private.mtg_can_decide(m, me.id) or (m.created_by = me.id and m.status in ('REQUESTED', 'PROPOSED'))) then
    raise exception 'FORBIDDEN: Only the Super Admin (CEO) can cancel a meeting with the CEO. You can withdraw a request that is still pending.' using errcode = '42501';
  end if;
  m := private.mtg_for_update(p_id, p_version);
  v_was := m.status;
  v_sa_host := private.mtg_host_is_sa(m.host_id);
  v_decider := private.mtg_can_decide(m, me.id);
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if m.source_type is not null then
    raise exception 'CONFLICT: This meeting is managed in its own page (demo, interview or HR meeting). Cancel it there.' using errcode = 'P0001';
  end if;
  if not (case when v_sa_host then v_decider or (m.created_by = me.id and m.status in ('REQUESTED', 'PROPOSED')) else private.mtg_can_manage(m, me.id) end) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can cancel it.' using errcode = '42501';
  end if;
  if m.status not in ('REQUESTED', 'PROPOSED', 'SCHEDULED') then
    raise exception 'CONFLICT: This meeting is already %.', lower(m.status) using errcode = 'P0001';
  end if;
  if v_sa_host and v_decider and m.created_by is distinct from me.id and v_reason is null then
    raise exception 'VALIDATION_ERROR: Give the reason for cancelling. The employee will see it.' using errcode = '22023';
  end if;
  update public.meetings set status = 'CANCELLED', cancel_reason = v_reason, cancelled_by = me.id, version = version + 1
   where id = m.id returning * into m;
  perform private.mtg_event(m.id, 'CANCELLED', v_reason, jsonb_build_object('fromStatus', v_was, 'toStatus', m.status, 'cancelledBy', me.id));
  perform private.mtg_notify_staff(m, 'MEETING_CANCELLED', 'Meeting cancelled: ' || m.title,
    private.mtg_when(m.starts_at, m.timezone) || coalesce('. Reason: ' || v_reason, '') || '.', me.id);
  if v_was <> 'REQUESTED' or m.booked_via = 'BOOKING_LINK' then
    perform private.mtg_mail_externals(m, 'CANCELLED');
  end if;
  perform private.write_audit('MEETING_CANCELLED', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('reason', v_reason, 'fromStatus', v_was));
  return private.mtg_json(m, me.id);
end $$;

-- ---------------------------------------------------------------------------
-- 8. The CEO's approvals are not delegated
-- ---------------------------------------------------------------------------
create or replace function public.mtg_set_delegates(p_delegates uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  if private.mtg_host_is_sa(me.id) then
    raise exception 'FORBIDDEN: Meeting decisions with the CEO cannot be delegated: only the Super Admin approves, rejects or reschedules.' using errcode = '42501';
  end if;
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
-- 9. One-time backfill: moves made before this migration show in the new columns (the history already has them)
-- ---------------------------------------------------------------------------
update public.meetings m set
  reschedule_count = e.n,
  previous_starts_at = coalesce(m.previous_starts_at, (e.last_data ->> 'from')::timestamptz),
  rescheduled_at = coalesce(m.rescheduled_at, e.last_at),
  rescheduled_by = coalesce(m.rescheduled_by, e.last_actor),
  reschedule_reason = coalesce(m.reschedule_reason, left(e.last_note, 1000))
  from (select meeting_id, count(*)::integer as n,
               (array_agg(data order by id desc))[1] as last_data, (array_agg(created_at order by id desc))[1] as last_at,
               (array_agg(actor_id order by id desc))[1] as last_actor, (array_agg(note order by id desc))[1] as last_note
          from public.meeting_events where kind in ('RESCHEDULED', 'PROPOSAL_ACCEPTED') group by meeting_id) e
 where e.meeting_id = m.id and m.reschedule_count = 0 and m.kind = 'CEO_MEETING';

-- ---------------------------------------------------------------------------
-- 10. Grants (the functions above keep the grants they had; the new one is granted next to its definition)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public.mtg_create(jsonb)', 'public.mtg_pending_approvals()', 'public.mtg_decide(uuid, text, text, timestamptz, timestamptz, integer)',
    'public.mtg_reschedule(uuid, timestamptz, timestamptz, text, integer)', 'public.mtg_cancel(uuid, text, integer)', 'public.mtg_set_delegates(uuid[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
