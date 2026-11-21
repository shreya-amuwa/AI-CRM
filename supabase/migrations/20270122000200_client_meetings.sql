-- =============================================================================
-- Client Meeting (docs/MEETINGS_GOOGLE_CALENDAR.md "Client meetings"). Run after 20270122000100_meeting_presence_all_employees.sql.
-- Additive and safe to run twice. Built on the existing meetings system, no second one:
--   * a meeting of kind CLIENT_MEETING (public.meetings), the client as its outside guest (meeting_attendees, role EXTERNAL), the client's
--     company in meetings.client_company, the agenda in meetings.description;
--   * the invitation, the new-time and the cancellation e-mails to the client go through the existing meeting e-mail outbox
--     (meeting_mail_outbox: one row per meeting, address, kind and meeting version, so a retry or a double click never sends twice; sent by the
--     server with the CRM's e-mail settings, retried with back-off, every attempt kept). For a client meeting the CRM always sends its own
--     e-mail to the client, even when Google also sends a calendar invitation (it carries the agenda, the company and the host's details);
--   * mtg_client_create(form): validates the form, refuses a conflict (the host already has a meeting then, or is BUSY now and it starts
--     within 30 minutes), saves the meeting and queues the invitation. The form's clientRequestId makes a resubmission return the first
--     meeting (no duplicate meeting, no duplicate e-mail);
--   * mtg_mail_log(meeting): the e-mails of a meeting with their delivery status (sent / waiting / failed and why) for the people who may
--     manage it; mtg_mail_retry(id): send a failed one again.
-- Reschedule, cancel and complete use the existing functions (mtg_reschedule / mtg_cancel / mtg_complete): they already queue the
-- "new time" and "cancelled" e-mails to the guests. Who may manage: the host and the person who created it (private.mtg_can_manage).
-- =============================================================================

alter table public.meetings drop constraint if exists meetings_kind_check;
alter table public.meetings add constraint meetings_kind_check
  check (kind in ('APPOINTMENT', 'DEMO', 'MEETING', 'INTERVIEW', 'CEO_MEETING', 'HR_MEETING', 'CLIENT_MEETING'));
alter table public.meetings add column if not exists client_company text;
alter table public.meetings add column if not exists client_request_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meetings_client_company_check') then
    alter table public.meetings add constraint meetings_client_company_check check (client_company is null or length(client_company) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meetings_client_request_id_check') then
    alter table public.meetings add constraint meetings_client_request_id_check check (client_request_id is null or length(client_request_id) between 8 and 80);
  end if;
end $$;
create unique index if not exists meetings_client_request_key on public.meetings (created_by, client_request_id) where client_request_id is not null;
create index if not exists meetings_client_kind_idx on public.meetings (host_id, starts_at) where kind = 'CLIENT_MEETING';

create or replace function private.mtg_kind_label(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'APPOINTMENT' then 'Appointment' when 'DEMO' then 'Demo' when 'MEETING' then 'Meeting' when 'INTERVIEW' then 'Interview'
    when 'CEO_MEETING' then 'Meeting with the CEO' when 'HR_MEETING' then 'HR meeting' when 'CLIENT_MEETING' then 'Client meeting' else 'Meeting' end
$$;

-- every meeting's JSON (20270114000100) plus the client's company of a client meeting
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
    'clientCompany', m.client_company,
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

-- the client's company with every meeting (the rest of the client is the EXTERNAL attendee)
create or replace function private.mtg_client_json(m public.meetings, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.mtg_json(m, p_viewer) || jsonb_build_object(
    'client', (select jsonb_build_object('name', a.name, 'email', a.email) from public.meeting_attendees a
                where a.meeting_id = m.id and a.role = 'EXTERNAL' order by a.created_at limit 1))
$$;

-- ---------------------------------------------------------------------------
-- Create a client meeting
-- ---------------------------------------------------------------------------
create or replace function public.mtg_client_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  v_host uuid := coalesce(private.try_uuid(p ->> 'hostId'), me.id);
  h public.profiles;
  v_name text := nullif(btrim(coalesce(p ->> 'clientName', '')), '');
  v_email text := lower(nullif(btrim(coalesce(p ->> 'clientEmail', '')), ''));
  v_company text := nullif(btrim(coalesce(p ->> 'companyName', '')), '');
  v_title text := nullif(btrim(coalesce(p ->> 'title', '')), '');
  v_agenda text := nullif(btrim(coalesce(p ->> 'agenda', '')), '');
  v_mode text := upper(coalesce(p ->> 'mode', ''));
  v_link text := nullif(btrim(coalesce(p ->> 'meetLink', '')), '');
  v_place text := nullif(btrim(coalesce(p ->> 'location', '')), '');
  v_key text := nullif(btrim(coalesce(p ->> 'clientRequestId', '')), '');
  v_start timestamptz;
  v_end timestamptz;
  v_busy text;
  m public.meetings;
begin
  -- the same form sent twice (a double click, a retry after a lost answer): the first meeting, nothing new
  if v_key is not null then
    select * into m from public.meetings where created_by = me.id and client_request_id = v_key;
    if m.id is not null then
      return private.mtg_client_json(m, me.id) || jsonb_build_object('duplicate', true);
    end if;
  end if;
  if v_name is null or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: Enter the client''s name.' using errcode = '22023';
  end if;
  if v_email is null or length(v_email) > 320 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: Enter a valid client e-mail address.' using errcode = '22023';
  end if;
  if v_company is null or length(v_company) > 200 then
    raise exception 'VALIDATION_ERROR: Enter the company name.' using errcode = '22023';
  end if;
  if v_title is null or length(v_title) not between 2 and 200 then
    raise exception 'VALIDATION_ERROR: Give the meeting a title (2-200 characters).' using errcode = '22023';
  end if;
  if v_agenda is null or length(v_agenda) not between 5 and 4000 then
    raise exception 'VALIDATION_ERROR: Describe the agenda (5-4000 characters).' using errcode = '22023';
  end if;
  if v_mode not in ('ONLINE', 'OFFLINE') then
    raise exception 'VALIDATION_ERROR: Choose Online or Offline.' using errcode = '22023';
  end if;
  if v_mode = 'ONLINE' and (v_link is null or v_link !~* '^https://[^\s]+$' or length(v_link) > 500) then
    raise exception 'VALIDATION_ERROR: Give the meeting link (https://...) for an online meeting.' using errcode = '22023';
  end if;
  if v_mode = 'OFFLINE' and (v_place is null or length(v_place) not between 3 and 500) then
    raise exception 'VALIDATION_ERROR: Give the meeting place (address) for an offline meeting.' using errcode = '22023';
  end if;
  begin
    v_start := (p ->> 'startsAt')::timestamptz;
    v_end := (p ->> 'endsAt')::timestamptz;
  exception when others then
    raise exception 'VALIDATION_ERROR: Give a valid date, start time and end time.' using errcode = '22023';
  end;
  if v_start is null or v_end is null or v_end <= v_start then
    raise exception 'VALIDATION_ERROR: The meeting must end after it starts.' using errcode = '22023';
  end if;
  if v_end - v_start > interval '12 hours' then
    raise exception 'VALIDATION_ERROR: A meeting can last at most 12 hours.' using errcode = '22023';
  end if;
  if v_start < now() - interval '5 minutes' then
    raise exception 'VALIDATION_ERROR: Pick a time in the future.' using errcode = '22023';
  end if;
  if v_key is not null and length(v_key) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Invalid request id.' using errcode = '22023';
  end if;
  -- the host: the one creating it, or an active colleague (never the Super Admin, whose time is asked for, not taken)
  select * into h from public.profiles where id = v_host and status = 'ACTIVE';
  if h.id is null then
    raise exception 'VALIDATION_ERROR: Choose an active employee as the host.' using errcode = '22023';
  end if;
  if h.role = 'SUPER_ADMIN' and h.id <> me.id then
    raise exception 'VALIDATION_ERROR: The CEO''s time is asked for with "Ask the CEO for time", not booked as a host.' using errcode = '22023';
  end if;

  v_busy := private.mtg_busy_now(array[v_host], v_start, me.id);
  if v_busy is not null then
    raise exception 'CONFLICT: % is in a meeting right now (Busy). Pick a later time.', v_busy using errcode = 'P0001';
  end if;
  perform private.mtg_lock_host(v_host);
  if private.mtg_host_conflict(v_host, v_start, v_end) is not null then
    raise exception 'CONFLICT: % a meeting at that time. Pick another time.',
      case when v_host = me.id then 'You already have' else h.full_name || ' already has' end using errcode = 'P0001';
  end if;

  insert into public.meetings (kind, title, description, host_id, created_by, starts_at, ends_at, timezone, mode, location, meet_link,
                               status, requires_approval, booked_via, client_company, client_request_id)
  values ('CLIENT_MEETING', v_title, v_agenda, v_host, me.id, v_start, v_end,
          coalesce(nullif(p ->> 'timezone', ''), (select timezone from public.meeting_host_settings where host_id = v_host), 'Asia/Kolkata'),
          case v_mode when 'ONLINE' then 'ONLINE_LINK' else 'IN_PERSON' end,
          case when v_mode = 'OFFLINE' then v_place end, case when v_mode = 'ONLINE' then v_link end,
          'SCHEDULED', false, 'STAFF', v_company, v_key)
  on conflict (created_by, client_request_id) where client_request_id is not null do nothing
  returning * into m;
  if m.id is null then
    -- the same form arrived twice at the same moment: the other one won
    select * into m from public.meetings where created_by = me.id and client_request_id = v_key;
    return private.mtg_client_json(m, me.id) || jsonb_build_object('duplicate', true);
  end if;

  insert into public.meeting_attendees (meeting_id, email, name, role) values (m.id, v_email, v_name, 'EXTERNAL') on conflict do nothing;
  if v_host <> me.id then
    insert into public.meeting_attendees (meeting_id, profile_id, role, response) values (m.id, me.id, 'REQUIRED', 'ACCEPTED') on conflict do nothing;
  end if;

  perform private.mtg_event(m.id, 'SCHEDULED', null, jsonb_build_object('startsAt', m.starts_at, 'endsAt', m.ends_at, 'toStatus', m.status,
    'clientMeeting', true, 'company', v_company));
  perform private.mtg_notify_staff(m, 'MEETING_INVITED', 'New client meeting: ' || m.title,
    v_company || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '. Booked by ' || me.full_name || '.', me.id);
  -- the invitation to the client (and the usual copies to the colleagues taking part), sent by the server's e-mail worker
  perform private.mtg_mail_externals(m, 'CONFIRMED');
  perform private.write_audit('CLIENT_MEETING_SCHEDULED', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('host', m.host_id, 'startsAt', m.starts_at, 'mode', m.mode));
  return private.mtg_client_json(m, me.id) || jsonb_build_object('duplicate', false);
end $$;

-- ---------------------------------------------------------------------------
-- The client meetings a person takes part in (host, the one who booked, invited colleagues): upcoming or past, by status
-- ---------------------------------------------------------------------------
create or replace function public.mtg_client_meetings(p_scope text default 'UPCOMING', p_status text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  if coalesce(p_scope, 'UPCOMING') not in ('UPCOMING', 'PAST', 'ALL') then
    raise exception 'VALIDATION_ERROR: Choose UPCOMING, PAST or ALL.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Choose SCHEDULED, RESCHEDULED, COMPLETED or CANCELLED.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(private.mtg_client_json(m, me.id) order by
             case when coalesce(p_scope, 'UPCOMING') = 'UPCOMING' then m.starts_at end asc,
             case when coalesce(p_scope, 'UPCOMING') <> 'UPCOMING' then m.starts_at end desc)
     from (select m.* from public.meetings m
            where m.kind = 'CLIENT_MEETING'
              and (m.host_id = me.id or m.created_by = me.id
                   or exists (select 1 from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id = me.id))
              and case coalesce(p_scope, 'UPCOMING') when 'UPCOMING' then m.ends_at >= now() when 'PAST' then m.ends_at < now() else true end
              and case p_status
                    when 'SCHEDULED' then m.status = 'SCHEDULED' and coalesce(m.reschedule_count, 0) = 0
                    when 'RESCHEDULED' then m.status = 'SCHEDULED' and coalesce(m.reschedule_count, 0) > 0
                    when 'COMPLETED' then m.status = 'COMPLETED'
                    when 'CANCELLED' then m.status = 'CANCELLED'
                    else true end
            order by m.starts_at desc
            limit least(greatest(coalesce(p_limit, 100), 1), 200)) m), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- E-mail delivery of a meeting, and sending a failed one again
-- ---------------------------------------------------------------------------
create or replace function public.mtg_mail_log(p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if not private.mtg_can_manage(m, me.id) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can see its e-mail delivery.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'toEmail', o.to_email, 'toName', o.to_name, 'kind', o.kind,
            'external', o.to_profile_id is null, 'status', o.status, 'attempts', o.attempts, 'lastError', o.last_error,
            'sentAt', o.sent_at, 'createdAt', o.created_at, 'meetingVersion', o.meeting_version,
            -- a later new-time or cancellation e-mail to the same person replaced this one: it is not sent again
            'superseded', exists (select 1 from public.meeting_mail_outbox n where n.meeting_id = o.meeting_id and lower(n.to_email) = lower(o.to_email)
                                   and n.id > o.id and n.kind in ('RESCHEDULED', 'CANCELLED'))) order by o.id desc)
            from public.meeting_mail_outbox o where o.meeting_id = m.id), '[]'::jsonb);
end $$;

create or replace function public.mtg_mail_retry(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  o public.meeting_mail_outbox;
  m public.meetings;
begin
  select * into o from public.meeting_mail_outbox where id = p_id for update;
  if o.id is not null then
    select * into m from public.meetings where id = o.meeting_id;
  end if;
  if o.id is null or not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: E-mail not found.' using errcode = 'P0002';
  end if;
  if not private.mtg_can_manage(m, me.id) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can send it again.' using errcode = '42501';
  end if;
  if o.status = 'SENT' then
    raise exception 'CONFLICT: This e-mail was already sent.' using errcode = 'P0001';
  end if;
  if o.status in ('PENDING', 'SENDING') then
    return jsonb_build_object('id', o.id, 'status', o.status);   -- already on its way: nothing to do (a double click)
  end if;
  -- an older e-mail replaced by a new-time or cancellation e-mail to the same person is not sent again (the newer one counts); a change of
  -- the meeting that sent nobody anything (a calendar sync) does not stop it
  if exists (select 1 from public.meeting_mail_outbox n where n.meeting_id = o.meeting_id and lower(n.to_email) = lower(o.to_email)
              and n.id > o.id and n.kind in ('RESCHEDULED', 'CANCELLED')) then
    raise exception 'CONFLICT: A newer e-mail about this meeting replaced this one; the newer e-mail is the one that counts.' using errcode = 'P0001';
  end if;
  update public.meeting_mail_outbox set status = 'PENDING', attempts = 0, last_error = null, send_after = now() where id = o.id;
  perform private.mtg_event(m.id, 'MAIL_RETRY', null, jsonb_build_object('mailId', o.id, 'to', o.to_email, 'kind', o.kind));
  perform private.write_audit('MEETING_MAIL_RETRY', 'meeting', m.id, me.department_id, me.team_id, jsonb_build_object('mailId', o.id, 'kind', o.kind));
  return jsonb_build_object('id', o.id, 'status', 'PENDING');
end $$;

do $$
declare
  f text;
begin
  execute 'revoke all on function private.mtg_client_json(public.meetings, uuid) from public, anon, authenticated';
  foreach f in array array['public.mtg_client_create(jsonb)', 'public.mtg_client_meetings(text, text, integer)', 'public.mtg_mail_log(uuid)', 'public.mtg_mail_retry(bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
