-- =============================================================================
-- Notification coverage: meetings, tasks and client chat (on the existing notification system)
-- =============================================================================
-- Nothing new is built for delivery: every notification below is a row in public.notifications written by private.notify / private.notify_once (so the bell, the
-- Notification Center, Realtime, the sound and the history work for it unchanged). This migration fills the gaps found by reading the code:
--
--  MEETINGS (all five events already notified; the message now carries what the employee and the CEO need):
--    * request   -> the CEO (and delegates): employee, department, subject, purpose, requested date and time, request date;
--    * approved  -> the requester: status, date and time, the CEO's message;       * rejected -> status and the reason;
--    * rescheduled / another time proposed -> previous and new date and time, the reason, the status;     * cancelled -> everyone on the meeting: status, who, the reason.
--  TASKS (assigned, update requested / follow-up / answered, progress, blocked, completed already notified):
--    * every task notification carries taskId, title, priority and due date in its data; "new task" also says the priority;
--    * NEW, from the database itself (a deferred trigger on work_tasks, so it holds for every way a task can change): priority changed, deadline changed, task
--      reopened, task moved to another person (the new person is told unless another notification already told them, the previous person is told it moved).
--  CLIENT CHAT:
--    * the first message of a conversation is announced as a NEW CONVERSATION (same type, its own title and data.newConversation); a colleague's reply notifies the Relationship Manager AND the Team Lead (once per
--      colleague per day); a changed Relationship Manager / Team Lead is told CHAT_ASSIGNED (the new one) / CHAT_REASSIGNED (the previous one);
--    * NEW: a client message nobody answered is reminded (public.chat_unanswered_remind, run by the scheduler that already runs every 5 minutes):
--      the Relationship Manager and whoever is handling it after 30 minutes; the Team Lead too (urgent) after 2 hours; once per unanswered message and level, only
--      between 08:00 and 21:00 India time, and only for messages from the last 3 days.
-- Not changed: who may read what (a notification is always only the recipient's own row), the bell, the push outbox. Safe to run twice. Nothing is deleted.
-- Needs 20270129000100_shared_client_support_access.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Task notifications carry the task's facts (one place, so every task function benefits)
-- ---------------------------------------------------------------------------
create or replace function private.tg_notifications_enrich()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t record;
begin
  if new.entity_type = 'work_task' and new.entity_id is not null then
    select w.title, w.priority, w.due_date into t from public.work_tasks w where w.id = new.entity_id;
    if found then
      new.data := jsonb_build_object('taskId', new.entity_id, 'taskTitle', t.title, 'priority', t.priority, 'dueDate', t.due_date) || coalesce(new.data, '{}'::jsonb);
      if new.type = 'TASK_ASSIGNED' and new.body !~ 'Priority:' then
        new.body := left(new.body, 1900) || ' · Priority: ' || initcap(lower(t.priority));
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_notifications_enrich() from public, anon, authenticated;
drop trigger if exists notifications_enrich on public.notifications;
create trigger notifications_enrich before insert on public.notifications for each row execute function private.tg_notifications_enrich();

-- ---------------------------------------------------------------------------
-- 2. Task changes: priority, deadline, reopened, moved to another person (deferred: it runs after the function that made the change has written its own notice)
-- ---------------------------------------------------------------------------
create or replace function private.tg_work_tasks_notify_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_name text := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'A manager');
  v_stamp text := to_char(new.updated_at, 'YYYYMMDDHH24MISSUS');
  v_dues text := case when new.due_date is null then 'no deadline' else to_char(new.due_date, 'DD Mon YYYY') end;
  r uuid;
begin
  if new.priority is distinct from old.priority then
    for r in select distinct x from unnest(array[new.assignee_id]) x where x is not null loop
      perform private.notify_once(r, 'TASK_PRIORITY_CHANGED', format('Task priority changed: %s', left(new.title, 150)),
        format('%s changed the priority from %s to %s%s.', v_name, initcap(lower(old.priority)), initcap(lower(new.priority)), case when new.due_date is null then '' else ' · due ' || v_dues end),
        'work_task', new.id, jsonb_build_object('dedupeKey', format('TASKPRI|%s|%s|%s', new.id, new.priority, v_stamp), 'from', old.priority, 'to', new.priority),
        case when new.priority = 'URGENT' then 'urgent' else 'normal' end);
    end loop;
  end if;
  if new.due_date is distinct from old.due_date then
    for r in select distinct x from unnest(array[new.assignee_id]) x where x is not null loop
      perform private.notify_once(r, 'TASK_DEADLINE_CHANGED', format('Task deadline changed: %s', left(new.title, 150)),
        format('%s changed the deadline from %s to %s · priority %s.', v_name,
               case when old.due_date is null then 'no deadline' else to_char(old.due_date, 'DD Mon YYYY') end, v_dues, initcap(lower(new.priority))),
        'work_task', new.id, jsonb_build_object('dedupeKey', format('TASKDUE|%s|%s|%s', new.id, coalesce(new.due_date::text, 'none'), v_stamp), 'from', old.due_date, 'to', new.due_date), 'normal');
    end loop;
  end if;
  if old.status in ('COMPLETED', 'NOT_COMPLETED') and new.status not in ('COMPLETED', 'NOT_COMPLETED') then
    for r in select distinct x from unnest(array[new.assignee_id, new.assigned_by]) x where x is not null loop
      perform private.notify_once(r, 'TASK_REOPENED', format('Task reopened: %s', left(new.title, 150)),
        format('%s reopened this task (it was %s, now %s)%s.', v_name, lower(replace(old.status, '_', ' ')), lower(replace(new.status, '_', ' ')),
               case when new.due_date is null then '' else ' · due ' || v_dues end),
        'work_task', new.id, jsonb_build_object('dedupeKey', format('TASKREOPEN|%s|%s', new.id, v_stamp)), 'normal');
    end loop;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    -- the new person: unless the function that moved the task already told them (a notice about this task in the last minute)
    if new.assignee_id is not null and not exists (
         select 1 from public.notifications n where n.recipient_id = new.assignee_id and n.entity_type = 'work_task' and n.entity_id = new.id
            and n.created_at > now() - interval '1 minute' and n.type in ('TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_DELEGATED', 'REASSIGNED_TO_YOU')) then
      perform private.notify(new.assignee_id, 'TASK_REASSIGNED', format('Task reassigned to you: %s', left(new.title, 150)),
        format('%s moved this task to you%s · priority %s.', v_name, case when new.due_date is null then '' else ' · due ' || v_dues end, initcap(lower(new.priority))), 'work_task', new.id);
    end if;
    if old.assignee_id is not null then
      perform private.notify(old.assignee_id, 'TASK_REASSIGNED_AWAY', format('Task moved to someone else: %s', left(new.title, 150)),
        format('%s moved this task to %s.', v_name, coalesce((select p.full_name from public.profiles p where p.id = new.assignee_id), 'someone else')), 'work_task', new.id);
    end if;
  end if;
  return null;
end $$;
revoke all on function private.tg_work_tasks_notify_changes() from public, anon, authenticated;
drop trigger if exists work_tasks_notify_changes on public.work_tasks;
create constraint trigger work_tasks_notify_changes after update of priority, due_date, status, assignee_id on public.work_tasks
  deferrable initially deferred for each row
  when (old.priority is distinct from new.priority or old.due_date is distinct from new.due_date or old.status is distinct from new.status or old.assignee_id is distinct from new.assignee_id)
  execute function private.tg_work_tasks_notify_changes();

-- ---------------------------------------------------------------------------
-- 3. Meetings: what the message says (copies of the latest definitions, changed where marked 20270202000200)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mtg_create(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- (20270202000200) who, from which department, the subject, the purpose, the requested date and time, and when it was asked
    perform private.mtg_notify_deciders(m, 'Meeting request from ' || me.full_name,
      m.title || ' — requested by ' || me.full_name || ' (' || coalesce((select d.name from public.departments d where d.id = me.department_id), 'no department') || '). Subject: ' || m.title
      || '. Purpose: ' || left(coalesce(nullif(btrim(m.description), ''), 'not given'), 500)
      || '. Requested for: ' || private.mtg_when(m.starts_at, m.timezone)
      || '. Requested on: ' || private.mtg_when(now(), m.timezone) || '. Approve, reschedule or reject.');
  else
    perform private.mtg_notify_staff(m, 'MEETING_INVITED', 'New ' || lower(private.mtg_kind_label(m.kind)) || ': ' || m.title,
      'By ' || me.full_name || ' — ' || private.mtg_when(m.starts_at, m.timezone) || '.', me.id);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  end if;
  perform private.write_audit('MEETING_' || case when v_waiting then 'PENDING_AVAILABILITY' when v_request then 'REQUESTED' else 'SCHEDULED' end, 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('kind', m.kind, 'host', m.host_id, 'startsAt', m.starts_at));
  return private.mtg_json(m, me.id);
end $function$;

CREATE OR REPLACE FUNCTION public.mtg_decide(p_id uuid, p_decision text, p_note text DEFAULT NULL::text, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'Status: Approved. Date and time: ' || private.mtg_when(m.starts_at, m.timezone) || coalesce('. Message from ' || me.full_name || ': ' || v_note, '') || '.', me.id);
    perform private.mtg_mail_externals(m, 'CONFIRMED');
  elsif p_decision = 'DECLINE' then
    update public.meetings set status = 'DECLINED', decided_by = me.id, decided_at = now(), decision_note = v_note, version = version + 1
     where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'DECLINED', v_note, jsonb_build_object('fromStatus', v_was, 'toStatus', m.status, 'decidedBy', me.id));
    perform private.mtg_notify_staff(m, 'MEETING_DECLINED', 'Meeting request rejected: ' || m.title,
      'Status: Rejected. Reason: ' || coalesce(v_note, 'No reason given.'), me.id);
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
      'Status: Rescheduled, waiting for your answer. Requested: ' || private.mtg_when(m.starts_at, m.timezone) || '. New time proposed: ' || private.mtg_when(p_starts_at, m.timezone)
      || coalesce('. Reason: ' || v_note, '') || '. Accept it or decline.', me.id, 'urgent');
    perform private.mtg_mail_externals(m, 'PROPOSED');
  else
    raise exception 'VALIDATION_ERROR: Decide APPROVE, DECLINE or PROPOSE.' using errcode = '22023';
  end if;
  perform private.write_audit('MEETING_' || p_decision || 'D', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('host', m.host_id, 'note', v_note, 'fromStatus', v_was, 'toStatus', m.status));
  return private.mtg_json(m, me.id);
end $function$;

CREATE OR REPLACE FUNCTION public.mtg_reschedule(p_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_note text DEFAULT NULL::text, p_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'Status: Rescheduled (' || lower(m.status) || '). Previous: ' || private.mtg_when(v_old, m.timezone) || '. New: ' || private.mtg_when(m.starts_at, m.timezone)
      || coalesce('. Reason: ' || v_note, '') || '. Moved by ' || me.full_name || '.', me.id);
    perform private.mtg_mail_externals(m, 'RESCHEDULED');
  end if;
  perform private.write_audit('MEETING_RESCHEDULED', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('from', v_old, 'to', p_starts_at, 'reason', v_note, 'fromStatus', v_was, 'toStatus', m.status));
  return private.mtg_json(m, me.id);
end $function$;

CREATE OR REPLACE FUNCTION public.mtg_cancel(p_id uuid, p_reason text DEFAULT NULL::text, p_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     and not (private.mtg_can_decide(m, me.id) or (m.created_by = me.id and m.status in ('REQUESTED', 'PROPOSED', 'PENDING_AVAILABILITY'))) then
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
  if not (case when v_sa_host then v_decider or (m.created_by = me.id and m.status in ('REQUESTED', 'PROPOSED', 'PENDING_AVAILABILITY')) else private.mtg_can_manage(m, me.id) end) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can cancel it.' using errcode = '42501';
  end if;
  if m.status not in ('REQUESTED', 'PROPOSED', 'SCHEDULED', 'PENDING_AVAILABILITY') then
    raise exception 'CONFLICT: This meeting is already %.', lower(m.status) using errcode = 'P0001';
  end if;
  if v_sa_host and v_decider and m.created_by is distinct from me.id and v_reason is null then
    raise exception 'VALIDATION_ERROR: Give the reason for cancelling. The employee will see it.' using errcode = '22023';
  end if;
  update public.meetings set status = 'CANCELLED', cancel_reason = v_reason, cancelled_by = me.id, version = version + 1
   where id = m.id returning * into m;
  perform private.mtg_event(m.id, 'CANCELLED', v_reason, jsonb_build_object('fromStatus', v_was, 'toStatus', m.status, 'cancelledBy', me.id));
  perform private.mtg_notify_staff(m, 'MEETING_CANCELLED', 'Meeting cancelled: ' || m.title,
    'Status: Cancelled by ' || me.full_name || '. Was: ' || private.mtg_when(m.starts_at, m.timezone) || coalesce('. Reason: ' || v_reason, '') || '.', me.id);
  if v_was not in ('REQUESTED', 'PENDING_AVAILABILITY') or m.booked_via = 'BOOKING_LINK' then
    perform private.mtg_mail_externals(m, 'CANCELLED');
  end if;
  perform private.write_audit('MEETING_CANCELLED', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('reason', v_reason, 'fromStatus', v_was));
  return private.mtg_json(m, me.id);
end $function$;

-- ---------------------------------------------------------------------------
-- 4. Client chat: new conversation, the Team Lead on a colleague's reply, assigned / reassigned
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_send_message(p_conversation uuid, p_body text, p_client_msg_id uuid, p_reply_to uuid DEFAULT NULL::uuid, p_attachments uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.chat_conversations;
  a text;
  me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_existing public.chat_messages;
  v_msg public.chat_messages;
  v_seq bigint;
  v_name text;
  v_label text;
  v_kind text;
  v_atts jsonb := '[]'::jsonb;
  v_n integer := coalesce(array_length(p_attachments, 1), 0);
  v_found integer;
  v_cust public.customers;
  v_to uuid;
  v_read bigint;
  v_block text;
  v_first boolean := false;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if a = 'REVIEWER' then
    raise exception 'FORBIDDEN: You can read this conversation as a reviewer, but only the client and their assigned team can write in it.' using errcode = '42501';
  end if;
  if p_client_msg_id is null then
    raise exception 'VALIDATION_ERROR: The message has no identifier. Please try again.' using errcode = 'P0001';
  end if;
  -- a retry or a double click: the message was already stored
  select * into v_existing from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
  if v_existing.id is not null then
    return private.chat_message_json(v_existing);
  end if;
  if v_n > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files to one message.' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: A message can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  if v_body = '' and v_n = 0 then
    raise exception 'VALIDATION_ERROR: Write a message first.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_messages x where x.sender_id = me and x.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'VALIDATION_ERROR: You are sending messages too fast. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  if c.kind = 'CLIENT' then
    select * into v_cust from public.customers where id = c.customer_id;
    -- the stage decides whom the client may write to and when (Meta Verifier first, the Relationship Manager after verification)
    v_block := private.chat_block_reason(c.id);
    if v_block is not null then
      raise exception 'VALIDATION_ERROR: %', v_block using errcode = 'P0001';
    end if;
  end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages r where r.id = p_reply_to and r.conversation_id = c.id) then
    raise exception 'VALIDATION_ERROR: The message you are replying to was not found.' using errcode = 'P0001';
  end if;
  if v_n > 0 then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.file_name, 'mime', t.mime_type, 'size', t.size_bytes) order by t.created_at), '[]'::jsonb)
      into v_found, v_atts from public.chat_attachments t
     where t.id = any (p_attachments) and t.conversation_id = c.id and t.uploader_id = me and t.status = 'READY' and t.message_id is null;
    if v_found <> v_n then
      raise exception 'VALIDATION_ERROR: One of the files is not ready or was already sent. Upload it again.' using errcode = 'P0001';
    end if;
  end if;

  if a = 'CLIENT' then
    v_name := coalesce(nullif(btrim(v_cust.name), ''), 'Client');
    v_label := 'Client';
    v_kind := 'CLIENT';
  else
    select p.full_name into v_name from public.profiles p where p.id = me;
    v_kind := 'STAFF';
    v_label := case when c.kind <> 'CLIENT' then null when c.channel = 'META' then 'Meta Verifier'
                    when me = private.support_lead_of(c.customer_id) then 'Team Lead'
                    -- (20270129000100) a colleague covering for the Relationship Manager is not labelled as the Relationship Manager
                    when me = private.support_member_of(c.customer_id) or private.client_group_member(c.id, me) then 'Relationship Manager'
                    else 'Support Team' end;
  end if;

  -- the row lock orders concurrent senders: seq is assigned one at a time
  update public.chat_conversations
     set last_seq = last_seq + 1, last_message_at = now(), updated_at = now(),
         last_message_preview = left(regexp_replace(case when v_body = '' then '[file] ' || (v_atts -> 0 ->> 'name') else v_body end, '\s+', ' ', 'g'), 160),
         last_sender_name = v_name
   where id = c.id returning last_seq into v_seq;
  begin
    insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, sender_label, kind, body, reply_to, client_msg_id, attachments)
    values (c.id, v_seq, me, v_kind, v_name, v_label, 'TEXT', v_body, p_reply_to, p_client_msg_id, v_atts)
    returning * into v_msg;
  exception when unique_violation then
    -- two requests with the same client_msg_id raced: the other one won
    select * into v_msg from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
    return private.chat_message_json(v_msg);
  end;
  if v_n > 0 then
    update public.chat_attachments set message_id = v_msg.id where id = any (p_attachments);
  end if;
  -- the sender has read everything up to their own message
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq) values (c.id, me, v_seq)
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
  if c.kind = 'CLIENT' then
    if a = 'CLIENT' then
      update public.chat_conversations set client_read_seq = v_seq where id = c.id;
    else
      update public.chat_conversations set staff_read_seq = greatest(staff_read_seq, v_seq) where id = c.id;
      -- (20270129000100) the replying employee is now the one handling it (information only; never changes the Relationship Manager)
      if c.channel = 'RM' then
        update public.chat_conversations set handling_by = me, handling_at = now() where id = c.id;
      end if;
    end if;
    -- bells: at most one per person per "unread run" (a new one only after they have read the chat)
    if a = 'CLIENT' then
      -- the client's first message ever in this conversation (a system line before it does not matter)
      v_first := (select count(*) from public.chat_messages fm where fm.conversation_id = c.id and fm.sender_kind = 'CLIENT') = 1;
      for v_to in select distinct x from unnest(case when c.channel = 'META' then array[private.meta_verifier_of(c.customer_id)]
                                              -- (20270129000100) plus the colleague who is actively handling this client now
                                              else array[private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id),
                                                         case when private.handling_active(c.handling_at) then c.handling_by end] end) x where x is not null loop
        select coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = v_to), 0) into v_read;
        -- (20270202000200) the very first message of a conversation says so (a new conversation), with who wrote and the text
        perform private.notify_once(v_to, 'CHAT_CLIENT_MESSAGE',
          format(case when v_first then 'New conversation from %s' else 'New message from %s' end, coalesce(v_cust.company, v_cust.name)),
          left(v_body, 200), 'chat', c.id, format('CHAT|%s|%s', c.id, v_read), jsonb_build_object('newConversation', v_first));
      end loop;
    else
      -- (20270129000100) the Relationship Manager is told, once, when a colleague answers their client
      -- (20270202000200) and so is the Team Lead, who monitors the conversation too
      if c.channel = 'RM' then
        for v_to in select distinct x from unnest(array[private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id)]) x where x is not null and x <> me loop
          perform private.notify_once(v_to, 'CHAT_COVER_REPLY',
            format('%s replied to %s', v_name, coalesce(v_cust.company, v_cust.name)), left(v_body, 200), 'chat', c.id,
            format('CHATCOVER|%s|%s|%s', c.id, me, current_date));
        end loop;
      end if;
      perform private.client_notify(c.customer_id, 'CHAT_MESSAGE', format('New message from %s', v_name), left(v_body, 200), 'chat', c.id,
        format('CHAT|%s|%s', c.id, (select c2.client_read_seq from public.chat_conversations c2 where c2.id = c.id) ));
    end if;
  end if;
  return private.chat_message_json(v_msg);
end $function$;

CREATE OR REPLACE FUNCTION private.tg_chat_team_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_customer uuid;
  v_conv uuid;
  v_team jsonb;
begin
  begin
    -- the same function serves customers (id) and customer_onboarding (customer_id)
    v_customer := (to_jsonb(new) ->> case when tg_table_name = 'customers' then 'id' else 'customer_id' end)::uuid;
    select id into v_conv from public.chat_conversations where kind = 'CLIENT' and customer_id = v_customer and channel = 'RM';
    if v_conv is not null then
      v_team := private.chat_team_json(v_customer);
      perform private.chat_system_message(v_conv, format('Your assigned team was updated. Relationship Manager: %s. Team Lead: %s.',
        coalesce(v_team -> 'teamMember' ->> 'name', 'not assigned yet'), coalesce(v_team -> 'teamLead' ->> 'name', 'not assigned yet')));
      -- (20270202000200) the people who now look after this client are told the conversation is theirs, and the ones who no longer do are told it moved
      declare
        v_old jsonb := to_jsonb(old);
        v_new jsonb := to_jsonb(new);
        v_company text := (select coalesce(nullif(btrim(c.company), ''), c.name) from public.customers c where c.id = v_customer);
        v_f text;
        v_o uuid;
        v_n uuid;
      begin
        foreach v_f in array case when tg_table_name = 'customers' then array['owner_id'] else array['team_member_id', 'team_lead_id'] end loop
          v_o := nullif(v_old ->> v_f, '')::uuid;
          v_n := nullif(v_new ->> v_f, '')::uuid;
          if v_n is distinct from v_o then
            if v_n is not null then
              perform private.notify(v_n, 'CHAT_ASSIGNED', format('Client chat assigned to you: %s', v_company),
                format('You are now the %s of this client. Open the conversation to read the history and reply.', case when v_f = 'team_lead_id' then 'Team Lead' else 'Relationship Manager' end),
                'chat', v_conv, jsonb_build_object('customerId', v_customer, 'role', v_f), 'urgent');
            end if;
            if v_o is not null then
              perform private.notify(v_o, 'CHAT_REASSIGNED', format('Client chat reassigned: %s', v_company),
                format('This client chat is now with %s.', coalesce((select p.full_name from public.profiles p where p.id = v_n), 'someone else')),
                'chat', v_conv, jsonb_build_object('customerId', v_customer, 'role', v_f), 'normal');
            end if;
          end if;
        end loop;
      end;
    end if;
  exception when others then
    -- chat must never stop a hand-over
    raise warning 'chat: could not record the team change for customer %: %', v_customer, sqlerrm;
  end;
  return null;
end $function$;

-- ---------------------------------------------------------------------------
-- 5. A client message nobody has answered (run by the scheduler every 5 minutes; service role only)
-- ---------------------------------------------------------------------------
create or replace function public.chat_unanswered_remind(p_now timestamptz default now(), p_first_minutes integer default 30, p_escalate_minutes integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_to uuid;
  v_n integer := 0;
  v_hour integer := extract(hour from (p_now at time zone 'Asia/Kolkata'))::integer;
  v_wait integer;
  v_company text;
begin
  -- outside 08:00-21:00 India time nobody is pinged; the reminders come at the next run inside the window (a message older than 3 days is dropped)
  if v_hour < 8 or v_hour >= 21 then
    return jsonb_build_object('reminded', 0, 'skipped', 'OUTSIDE_HOURS');
  end if;
  for r in
    select c.id as conv, c.customer_id, m.seq, m.created_at, m.id as msg
      from public.chat_conversations c
      join lateral (select x.* from public.chat_messages x where x.conversation_id = c.id and x.deleted_at is null and x.kind = 'TEXT' order by x.seq desc limit 1) m on true
     where c.kind = 'CLIENT' and c.channel = 'RM' and m.sender_kind = 'CLIENT'
       and m.created_at <= p_now - make_interval(mins => greatest(p_first_minutes, 1))
       and m.created_at > p_now - interval '3 days'
  loop
    v_wait := greatest(extract(epoch from (p_now - r.created_at))::integer / 60, 0);
    v_company := (select coalesce(nullif(btrim(cu.company), ''), cu.name) from public.customers cu where cu.id = r.customer_id);
    -- level 1: the Relationship Manager and whoever is handling the chat now (the Team Lead when the client has no Relationship Manager)
    for v_to in select distinct x from unnest(array[private.support_member_of(r.customer_id),
                       (select case when private.handling_active(h.handling_at) then h.handling_by end from public.chat_conversations h where h.id = r.conv),
                       case when private.support_member_of(r.customer_id) is null then private.support_lead_of(r.customer_id) end]) x where x is not null loop
      insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, data, priority)
      values (v_to, 'CHAT_UNANSWERED', format('Client waiting: %s', v_company), format('No reply for %s minutes. Open the conversation and answer.', v_wait), 'chat', r.conv,
              jsonb_build_object('dedupeKey', format('CHATWAIT1|%s|%s', r.conv, r.seq), 'customerId', r.customer_id, 'waitingMinutes', v_wait), 'normal')
      on conflict (recipient_id, (data ->> 'dedupeKey')) where data ? 'dedupeKey' do nothing;
      if found then v_n := v_n + 1; end if;
    end loop;
    -- level 2: still nobody answered after the escalation time: the Team Lead too (and the Relationship Manager again, as urgent)
    if r.created_at <= p_now - make_interval(mins => greatest(p_escalate_minutes, p_first_minutes + 1)) then
      for v_to in select distinct x from unnest(array[private.support_lead_of(r.customer_id), private.support_member_of(r.customer_id)]) x where x is not null loop
        insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, data, priority)
        select v_to, 'CHAT_UNANSWERED', format('Client still waiting: %s', v_company), format('No reply for %s minutes. Please make sure someone answers.', v_wait), 'chat', r.conv,
               jsonb_build_object('dedupeKey', format('CHATWAIT2|%s|%s', r.conv, r.seq), 'customerId', r.customer_id, 'waitingMinutes', v_wait), 'urgent'
        on conflict (recipient_id, (data ->> 'dedupeKey')) where data ? 'dedupeKey' do nothing;
        if found then v_n := v_n + 1; end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('reminded', v_n);
end $$;
revoke all on function public.chat_unanswered_remind(timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.chat_unanswered_remind(timestamptz, integer, integer) to service_role;
notify pgrst, 'reload schema';
