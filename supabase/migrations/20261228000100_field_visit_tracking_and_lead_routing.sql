-- =============================================================================
-- Field Visit: live location while a visit is in progress, Field Visit leads routed through the Sales Department Head to a Telecaller,
-- and a lead create that a retry cannot duplicate. Additive and safe to run again. Run after 20261227000100.
--
-- 1. Live location (extends lead_visits, the visits of the Field Visit pages; the older trip tracker public.field_visits is untouched)
--    lead_visits gets tracking columns (no coordinates). The positions themselves live in lead_visit_locations, readable only by the people
--    allowed to track that employee (private.can_track_visitor): the employee, their direct Team Lead, a Sales Department Head of their
--    department, a Sales Operations Head whose scope covers that department's Sales side, and HR staff (private.is_hr_staff). Supabase Realtime
--    applies the same row rule, so a position reaches only those people. A Support Operations Head, another Team Lead, a colleague: nothing.
--    Positions are accepted only for the employee's own visit while it is IN_PROGRESS and tracking is ACTIVE: never outside a visit. Ending the
--    visit (any way) stops tracking. Start, stop, a refused permission and a GPS failure are recorded in lead_visit_tracking_events.
--    Retention: positions and events older than field_visit_tracking_settings.retention_days (90) are removed by
--    private.purge_field_visit_tracking() (scheduled daily when pg_cron is installed; otherwise run public.purge_field_visit_tracking()).
--
-- 2. Field Visit leads -> Sales Department Head -> Telecaller
--    A lead with the source "Field visit" added by a Field Visit employee (Telecaller, Business Associate or Sales Team Member, any form) gets a
--    field_visit_lead_routes row (PENDING) and the Sales Department Heads covering it are notified. The head assigns it to an active
--    Telecaller: the Telecaller becomes the owner (so it is in their Leads), customers.created_by keeps the person who added it, and every
--    assignment is kept in field_visit_lead_assignment_events. While it is PENDING the person who added it (or a Team Lead / member) cannot
--    change its owner, stage or Accounts workflow: only the head decides. Nothing else of the Accounts, payment or onboarding flow changes.
--
-- 3. create_lead_once(fields, services, request): the existing create_lead, run once per (person, request id): a retry or a double click
--    returns the first lead. create_lead itself is unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Tables and columns
-- ---------------------------------------------------------------------------
alter table public.lead_visits add column if not exists tracking_status text not null default 'OFF';
alter table public.lead_visits add column if not exists tracking_started_at timestamptz;
alter table public.lead_visits add column if not exists tracking_stopped_at timestamptz;
alter table public.lead_visits add column if not exists tracking_stop_reason text;
alter table public.lead_visits add column if not exists tracking_issue text;
alter table public.lead_visits add column if not exists tracking_issue_at timestamptz;
do $$ begin
  alter table public.lead_visits add constraint lead_visits_tracking_status_check check (tracking_status in ('OFF', 'ACTIVE', 'STOPPED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lead_visits add constraint lead_visits_tracking_reason_check
    check (tracking_stop_reason is null or tracking_stop_reason in ('STOPPED_BY_EMPLOYEE', 'VISIT_ENDED', 'PERMISSION_DENIED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lead_visits add constraint lead_visits_tracking_issue_check
    check (tracking_issue is null or tracking_issue in ('PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT'));
exception when duplicate_object then null; end $$;
create index if not exists lead_visits_tracking_idx on public.lead_visits (tracking_status, tracking_started_at desc) where tracking_status <> 'OFF';

create table if not exists public.lead_visit_locations (
  id bigint generated always as identity primary key,
  visit_id uuid not null references public.lead_visits (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  accuracy_m integer not null check (accuracy_m between 0 and 100000),
  -- when the phone took the position (a point sent after a network gap keeps its own time), and when the server got it
  recorded_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists lead_visit_locations_visit_idx on public.lead_visit_locations (visit_id, recorded_at desc);
create index if not exists lead_visit_locations_employee_idx on public.lead_visit_locations (employee_id, recorded_at desc);
create index if not exists lead_visit_locations_age_idx on public.lead_visit_locations (received_at);

create table if not exists public.lead_visit_tracking_events (
  id bigint generated always as identity primary key,
  visit_id uuid not null references public.lead_visits (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  event text not null check (event in ('STARTED', 'STOPPED', 'VISIT_ENDED', 'PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT')),
  created_at timestamptz not null default now()
);
create index if not exists lead_visit_tracking_events_visit_idx on public.lead_visit_tracking_events (visit_id, created_at);
create index if not exists lead_visit_tracking_events_age_idx on public.lead_visit_tracking_events (created_at);

create table if not exists public.field_visit_tracking_settings (
  id boolean primary key default true check (id),
  retention_days integer not null default 90 check (retention_days between 7 and 730),
  updated_at timestamptz not null default now()
);
insert into public.field_visit_tracking_settings (id) values (true) on conflict (id) do nothing;
alter table public.field_visit_tracking_settings enable row level security;
revoke all on public.field_visit_tracking_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Who may see an employee's field location
-- ---------------------------------------------------------------------------
create or replace function private.can_track_visitor(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee is not null and (
    p_employee = private.my_id()
    or private.is_hr_staff()
    or exists (
      select 1 from public.profiles e join public.teams t on t.id = e.team_id, public.profiles me
       where e.id = p_employee and t.division = 'SALES'
         and me.id = private.my_id() and me.status = 'ACTIVE'
         and ((me.role = 'TEAM_HEAD' and private.direct_lead_of(e.id) = me.id)
              or (me.role = 'DEPARTMENT_HEAD' and not me.is_operations_head and private.head_covers(me.id, private.base_department(e.department_id), e.team_id))
              or (me.role = 'DEPARTMENT_HEAD' and me.is_operations_head and private.scope_covers(me.id, e.department_id, 'SALES')))))
$$;
revoke all on function private.can_track_visitor(uuid) from public, anon;
grant execute on function private.can_track_visitor(uuid) to authenticated, service_role;

alter table public.lead_visit_locations enable row level security;
alter table public.lead_visit_tracking_events enable row level security;
revoke all on public.lead_visit_locations, public.lead_visit_tracking_events from anon, authenticated;
grant select on public.lead_visit_locations, public.lead_visit_tracking_events to authenticated;
drop policy if exists lead_visit_locations_select on public.lead_visit_locations;
create policy lead_visit_locations_select on public.lead_visit_locations for select to authenticated using (private.can_track_visitor(employee_id));
drop policy if exists lead_visit_tracking_events_select on public.lead_visit_tracking_events;
create policy lead_visit_tracking_events_select on public.lead_visit_tracking_events for select to authenticated using (private.can_track_visitor(employee_id));
do $$ begin
  alter publication supabase_realtime add table public.lead_visit_locations;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1c. Ending a visit always ends tracking (complete, follow-up, cancel, or anything else that moves it out of IN_PROGRESS)
-- ---------------------------------------------------------------------------
create or replace function private.tg_lead_visits_tracking_end()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'IN_PROGRESS' and old.tracking_status = 'ACTIVE' then
    new.tracking_status := 'STOPPED';
    new.tracking_stopped_at := now();
    new.tracking_stop_reason := 'VISIT_ENDED';
    insert into public.lead_visit_tracking_events (visit_id, employee_id, event) values (old.id, old.employee_id, 'VISIT_ENDED');
  end if;
  return new;
end $$;
revoke all on function private.tg_lead_visits_tracking_end() from public, anon, authenticated;
drop trigger if exists lead_visits_tracking_end on public.lead_visits;
create trigger lead_visits_tracking_end before update of status on public.lead_visits for each row execute function private.tg_lead_visits_tracking_end();

-- ---------------------------------------------------------------------------
-- 1d. The employee: start, positions, a problem, stop
-- ---------------------------------------------------------------------------
-- the employee's own visit, locked, that may be tracked now
create or replace function private.tracking_visit(p_id uuid)
returns public.lead_visits language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits;
begin
  perform private.require_field_visit_user();
  select * into v from public.lead_visits where id = p_id and employee_id = private.my_id() for update;
  if v.id is null then raise exception 'NOT_FOUND: Visit not found.' using errcode = 'P0001'; end if;
  return v;
end $$;
revoke all on function private.tracking_visit(uuid) from public, anon, authenticated;

create or replace function private.lead_visit_tracking_json(v public.lead_visits)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'visitId', v.id, 'visitStatus', v.status, 'trackingStatus', v.tracking_status, 'trackingStartedAt', v.tracking_started_at,
    'trackingStoppedAt', v.tracking_stopped_at, 'stopReason', v.tracking_stop_reason, 'issue', v.tracking_issue, 'issueAt', v.tracking_issue_at,
    'lastLocation', (select jsonb_build_object('latitude', l.latitude, 'longitude', l.longitude, 'accuracyMeters', l.accuracy_m, 'recordedAt', l.recorded_at)
                       from public.lead_visit_locations l where l.visit_id = v.id order by l.recorded_at desc, l.id desc limit 1),
    'points', (select count(*) from public.lead_visit_locations l where l.visit_id = v.id))
$$;
revoke all on function private.lead_visit_tracking_json(public.lead_visits) from public, anon, authenticated;

-- stores one position; false when it is outside the visit, a duplicate, or too soon after the previous one (a phone can report every second)
create or replace function private.tracking_store_point(v public.lead_visits, p_lat numeric, p_lng numeric, p_accuracy integer, p_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_last timestamptz;
  v_at timestamptz := least(p_at, now());  -- a phone clock a little ahead is stored as "now"
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or (p_lat = 0 and p_lng = 0) then
    raise exception 'VALIDATION_ERROR: The location is not valid.' using errcode = 'P0001';
  end if;
  if p_accuracy is null or p_accuracy < 0 or p_accuracy > 100000 then raise exception 'VALIDATION_ERROR: The accuracy is not valid.' using errcode = 'P0001'; end if;
  -- only positions taken while this visit was being tracked; a clock a little ahead is tolerated, the future is not
  if p_at is null or p_at < v.tracking_started_at - interval '2 minutes' or p_at > now() + interval '2 minutes' then return false; end if;
  select max(recorded_at) into v_last from public.lead_visit_locations where visit_id = v.id;
  if v_last is not null and abs(extract(epoch from (v_at - v_last))) < 15 then return false; end if;
  if (select count(*) from public.lead_visit_locations where visit_id = v.id) >= 2000 then return false; end if;
  insert into public.lead_visit_locations (visit_id, employee_id, latitude, longitude, accuracy_m, recorded_at)
  values (v.id, v.employee_id, round(p_lat, 6), round(p_lng, 6), p_accuracy, v_at);
  return true;
end $$;
revoke all on function private.tracking_store_point(public.lead_visits, numeric, numeric, integer, timestamptz) from public, anon, authenticated;

-- The employee chose to share their location for this visit (after the browser asked them). Only while it is in progress.
create or replace function public.field_visit_tracking_start(p_id uuid, p_lat numeric, p_lng numeric, p_accuracy integer, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits := private.tracking_visit(p_id);
begin
  if v.status <> 'IN_PROGRESS' then raise exception 'CONFLICT: Start the visit first; location is shared only while a visit is in progress.' using errcode = 'P0001'; end if;
  if v.tracking_status <> 'ACTIVE' then
    update public.lead_visits set tracking_status = 'ACTIVE', tracking_started_at = coalesce(tracking_started_at, now()), tracking_stopped_at = null,
           tracking_stop_reason = null, tracking_issue = null, tracking_issue_at = null
     where id = v.id returning * into v;
    insert into public.lead_visit_tracking_events (visit_id, employee_id, event) values (v.id, v.employee_id, 'STARTED');
    perform private.write_audit('FIELD_VISIT_TRACKING_STARTED', 'lead_visit', v.id, (select department_id from public.profiles where id = v.employee_id),
      (select team_id from public.profiles where id = v.employee_id), jsonb_build_object('visit', v.id));
  else
    update public.lead_visits set tracking_issue = null, tracking_issue_at = null where id = v.id returning * into v;
  end if;
  perform private.tracking_store_point(v, p_lat, p_lng, p_accuracy, coalesce(p_at, now()));
  return private.lead_visit_tracking_json(v);
end $$;
revoke all on function public.field_visit_tracking_start(uuid, numeric, numeric, integer, timestamptz) from public, anon;
grant execute on function public.field_visit_tracking_start(uuid, numeric, numeric, integer, timestamptz) to authenticated;

-- New positions, sent in small batches (a batch kept while the phone was offline arrives with the times the positions were taken)
create or replace function public.field_visit_tracking_points(p_id uuid, p_points jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits := private.tracking_visit(p_id);
  p jsonb;
  v_saved integer := 0;
begin
  if v.status <> 'IN_PROGRESS' or v.tracking_status <> 'ACTIVE' then
    raise exception 'CONFLICT: Location sharing has ended for this visit.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_points) is distinct from 'array' or jsonb_array_length(p_points) = 0 or jsonb_array_length(p_points) > 50 then
    raise exception 'VALIDATION_ERROR: Send between 1 and 50 positions.' using errcode = 'P0001';
  end if;
  for p in select x from jsonb_array_elements(p_points) x order by (x ->> 'recordedAt')::timestamptz loop
    if private.tracking_store_point(v, (p ->> 'latitude')::numeric, (p ->> 'longitude')::numeric, (p ->> 'accuracyMeters')::integer, (p ->> 'recordedAt')::timestamptz) then
      v_saved := v_saved + 1;
    end if;
  end loop;
  if v_saved > 0 and v.tracking_issue is not null then
    update public.lead_visits set tracking_issue = null, tracking_issue_at = null where id = v.id returning * into v;
  end if;
  return private.lead_visit_tracking_json(v) || jsonb_build_object('saved', v_saved);
end $$;
revoke all on function public.field_visit_tracking_points(uuid, jsonb) from public, anon;
grant execute on function public.field_visit_tracking_points(uuid, jsonb) to authenticated;

-- The phone could not give a position (permission withdrawn, no GPS fix). Recorded once per kind until a position arrives again; a refused
-- permission also ends tracking (the browser will not ask again by itself).
create or replace function public.field_visit_tracking_issue(p_id uuid, p_issue text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits := private.tracking_visit(p_id);
begin
  if p_issue is null or p_issue not in ('PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT') then
    raise exception 'VALIDATION_ERROR: Unknown location problem.' using errcode = 'P0001';
  end if;
  if v.tracking_status <> 'ACTIVE' or v.tracking_issue is not distinct from p_issue then return private.lead_visit_tracking_json(v); end if;
  update public.lead_visits
     set tracking_issue = p_issue, tracking_issue_at = now(),
         tracking_status = case when p_issue = 'PERMISSION_DENIED' then 'STOPPED' else tracking_status end,
         tracking_stopped_at = case when p_issue = 'PERMISSION_DENIED' then now() else tracking_stopped_at end,
         tracking_stop_reason = case when p_issue = 'PERMISSION_DENIED' then 'PERMISSION_DENIED' else tracking_stop_reason end
   where id = v.id returning * into v;
  insert into public.lead_visit_tracking_events (visit_id, employee_id, event) values (v.id, v.employee_id, p_issue);
  return private.lead_visit_tracking_json(v);
end $$;
revoke all on function public.field_visit_tracking_issue(uuid, text) from public, anon;
grant execute on function public.field_visit_tracking_issue(uuid, text) to authenticated;

create or replace function public.field_visit_tracking_stop(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits := private.tracking_visit(p_id);
begin
  if v.tracking_status = 'ACTIVE' then
    update public.lead_visits set tracking_status = 'STOPPED', tracking_stopped_at = now(), tracking_stop_reason = 'STOPPED_BY_EMPLOYEE' where id = v.id returning * into v;
    insert into public.lead_visit_tracking_events (visit_id, employee_id, event) values (v.id, v.employee_id, 'STOPPED');
    perform private.write_audit('FIELD_VISIT_TRACKING_STOPPED', 'lead_visit', v.id, (select department_id from public.profiles where id = v.employee_id),
      (select team_id from public.profiles where id = v.employee_id), jsonb_build_object('visit', v.id));
  end if;
  return private.lead_visit_tracking_json(v);
end $$;
revoke all on function public.field_visit_tracking_stop(uuid) from public, anon;
grant execute on function public.field_visit_tracking_stop(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1e. The managers: the board (visits in progress, and tracked visits of the day) and one visit's trail. Every read is checked per employee.
-- ---------------------------------------------------------------------------
create or replace function private.require_tracking_viewer()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or not (private.is_hr_staff() or me.role in ('TEAM_HEAD', 'DEPARTMENT_HEAD')) then
    raise exception 'FORBIDDEN: Field visit tracking is for Team Leads, Department Heads, Operations Heads and HR.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_tracking_viewer() from public, anon, authenticated;

-- an access record, at most one per viewer and visit (or board) every 30 minutes
create or replace function private.tracking_audit_view(p_action text, p_visit uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.audit_logs a where a.actor_id = private.my_id() and a.action = p_action
                    and a.entity_id is not distinct from p_visit and a.created_at > now() - interval '30 minutes') then
    perform private.write_audit(p_action, 'lead_visit', p_visit, null, null, '{}'::jsonb);
  end if;
end $$;
revoke all on function private.tracking_audit_view(text, uuid) from public, anon, authenticated;

create or replace function public.field_visit_tracking_board(p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date := coalesce(p_date, private.ist_today());
begin
  perform private.require_tracking_viewer();
  if v_day > private.ist_today() or v_day < private.ist_today() - 730 then raise exception 'VALIDATION_ERROR: Choose a date in the last two years.' using errcode = 'P0001'; end if;
  perform private.tracking_audit_view('FIELD_VISIT_TRACKING_BOARD_VIEWED', null);
  return jsonb_build_object('date', v_day, 'serverTime', now(), 'items', coalesce((
    select jsonb_agg(x.j order by x.sort desc) from (
      select private.lead_visit_tracking_json(v) || jsonb_build_object(
               'employee', jsonb_build_object('id', e.id, 'fullName', e.full_name, 'phone', e.phone),
               'department', d.name, 'team', t.name,
               'teamLead', (select l.full_name from public.profiles l where l.id = private.direct_lead_of(e.id)),
               'lead', jsonb_build_object('id', c.id, 'name', c.name, 'company', c.company, 'address', coalesce(v.address, c.address)),
               'purpose', v.purpose, 'visitDate', v.visit_date, 'startedAt', v.started_at, 'completedAt', v.completed_at,
               'checkin', case when v.gps_captured then jsonb_build_object('latitude', v.checkin_lat, 'longitude', v.checkin_lng, 'accuracyMeters', v.checkin_accuracy_m, 'at', v.checkin_at) end) as j,
             coalesce(v.tracking_started_at, v.started_at, v.created_at) as sort
        from public.lead_visits v
        join public.profiles e on e.id = v.employee_id
        left join public.teams t on t.id = e.team_id
        left join public.departments d on d.id = e.department_id
        join public.customers c on c.id = v.lead_id
       where private.can_track_visitor(v.employee_id) and v.employee_id <> private.my_id()
         and ((v_day = private.ist_today() and v.status = 'IN_PROGRESS')
              or (v.tracking_started_at is not null and (v.tracking_started_at at time zone 'Asia/Kolkata')::date = v_day)
              or (v.started_at is not null and (v.started_at at time zone 'Asia/Kolkata')::date = v_day))
       limit 300) x), '[]'::jsonb));
end $$;
revoke all on function public.field_visit_tracking_board(date) from public, anon;
grant execute on function public.field_visit_tracking_board(date) to authenticated;

-- one visit's positions and tracking events: its employee, or a person allowed to track them
create or replace function public.field_visit_tracking_trail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits;
begin
  select * into v from public.lead_visits where id = p_id;
  if v.id is null or not private.can_track_visitor(v.employee_id) then raise exception 'NOT_FOUND: Visit not found.' using errcode = 'P0001'; end if;
  if v.employee_id <> private.my_id() then perform private.tracking_audit_view('FIELD_VISIT_TRACKING_VIEWED', v.id); end if;
  return private.lead_visit_tracking_json(v) || jsonb_build_object(
    'locations', coalesce((select jsonb_agg(jsonb_build_object('latitude', l.latitude, 'longitude', l.longitude, 'accuracyMeters', l.accuracy_m,
                                                               'recordedAt', l.recorded_at, 'receivedAt', l.received_at) order by l.recorded_at desc, l.id desc)
                             from (select * from public.lead_visit_locations where visit_id = v.id order by recorded_at desc, id desc limit 500) l), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event', ev.event, 'at', ev.created_at) order by ev.created_at, ev.id)
                          from public.lead_visit_tracking_events ev where ev.visit_id = v.id), '[]'::jsonb));
end $$;
revoke all on function public.field_visit_tracking_trail(uuid) from public, anon;
grant execute on function public.field_visit_tracking_trail(uuid) to authenticated;

-- the tracking fields on the visit the employee already reads (lead_visit_json is the shape of every visit the Field Visit API returns)
create or replace function private.lead_visit_json(v public.lead_visits)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id, 'leadId', v.lead_id, 'leadName', c.name, 'company', c.company, 'phone', c.phone,
    'visitDate', v.visit_date, 'plannedTime', to_char(v.planned_time, 'HH24:MI'), 'address', v.address, 'purpose', v.purpose,
    'status', v.status, 'notes', v.notes, 'outcome', v.outcome, 'requirements', v.requirements, 'nextSteps', v.next_steps,
    'nextFollowUp', v.next_follow_up, 'cancelReason', v.cancel_reason, 'startedAt', v.started_at, 'completedAt', v.completed_at,
    'gpsCaptured', v.gps_captured, 'checkinLat', v.checkin_lat, 'checkinLng', v.checkin_lng, 'checkinAccuracyM', v.checkin_accuracy_m,
    'checkinAt', v.checkin_at, 'locationNote', v.location_note,
    'assignedBy', (select p.full_name from public.profiles p where p.id = v.assigned_by), 'assignmentId', v.assignment_id,
    'employee', jsonb_build_object('id', e.id, 'fullName', e.full_name), 'taskId', v.task_id,
    'trackingStatus', v.tracking_status, 'trackingStartedAt', v.tracking_started_at, 'trackingStoppedAt', v.tracking_stopped_at,
    'createdAt', v.created_at, 'updatedAt', v.updated_at)
  from public.customers c, public.profiles e
 where c.id = v.lead_id and e.id = v.employee_id
$$;
revoke all on function private.lead_visit_json(public.lead_visits) from public, anon;
grant execute on function private.lead_visit_json(public.lead_visits) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1f. Retention
-- ---------------------------------------------------------------------------
create or replace function private.purge_field_visit_tracking()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_days integer := coalesce((select retention_days from public.field_visit_tracking_settings where id), 90);
  v_points integer;
  v_events integer;
begin
  delete from public.lead_visit_locations where received_at < now() - make_interval(days => v_days);
  get diagnostics v_points = row_count;
  delete from public.lead_visit_tracking_events where created_at < now() - make_interval(days => v_days);
  get diagnostics v_events = row_count;
  return jsonb_build_object('retentionDays', v_days, 'locationsRemoved', v_points, 'eventsRemoved', v_events);
end $$;
revoke all on function private.purge_field_visit_tracking() from public, anon, authenticated;

create or replace function public.purge_field_visit_tracking()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not private.is_super_admin() then raise exception 'FORBIDDEN: Only the Super Admin can do this.' using errcode = '42501'; end if;
  v_result := private.purge_field_visit_tracking();
  perform private.write_audit('FIELD_VISIT_TRACKING_PURGED', 'settings', null, null, null, v_result);
  return v_result;
end $$;
revoke all on function public.purge_field_visit_tracking() from public, anon;
grant execute on function public.purge_field_visit_tracking() to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-field-visit-tracking', '17 21 * * *', 'select private.purge_field_visit_tracking()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 2a. Field Visit leads waiting for the Sales Department Head
-- ---------------------------------------------------------------------------
create table if not exists public.field_visit_lead_routes (
  lead_id uuid primary key references public.customers (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING', 'ASSIGNED')),
  assigned_to uuid references public.profiles (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists field_visit_lead_routes_queue_idx on public.field_visit_lead_routes (department_id, status, created_at desc);
create index if not exists field_visit_lead_routes_creator_idx on public.field_visit_lead_routes (created_by);
create index if not exists field_visit_lead_routes_assignee_idx on public.field_visit_lead_routes (assigned_to);
create index if not exists field_visit_lead_routes_by_idx on public.field_visit_lead_routes (assigned_by);
drop trigger if exists field_visit_lead_routes_set_updated_at on public.field_visit_lead_routes;
create trigger field_visit_lead_routes_set_updated_at before update on public.field_visit_lead_routes for each row execute function public.tg_set_updated_at();

create table if not exists public.field_visit_lead_assignment_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.customers (id) on delete cascade,
  assigned_to uuid references public.profiles (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  previous_owner uuid references public.profiles (id) on delete set null,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists field_visit_lead_assignment_events_lead_idx on public.field_visit_lead_assignment_events (lead_id, created_at);
create index if not exists field_visit_lead_assignment_events_to_idx on public.field_visit_lead_assignment_events (assigned_to);
create index if not exists field_visit_lead_assignment_events_by_idx on public.field_visit_lead_assignment_events (assigned_by);
create index if not exists field_visit_lead_assignment_events_prev_idx on public.field_visit_lead_assignment_events (previous_owner);

alter table public.field_visit_lead_routes enable row level security;
alter table public.field_visit_lead_assignment_events enable row level security;
revoke all on public.field_visit_lead_routes, public.field_visit_lead_assignment_events from anon, authenticated;
grant select on public.field_visit_lead_routes, public.field_visit_lead_assignment_events to authenticated;
drop policy if exists field_visit_lead_routes_select on public.field_visit_lead_routes;
create policy field_visit_lead_routes_select on public.field_visit_lead_routes for select to authenticated
  using (created_by = (select private.my_id()) or assigned_to = (select private.my_id()) or private.can_view_customer(lead_id));
do $$ begin
  alter publication supabase_realtime add table public.field_visit_lead_routes;
exception when duplicate_object then null; when undefined_object then null; end $$;
drop policy if exists field_visit_lead_assignment_events_select on public.field_visit_lead_assignment_events;
create policy field_visit_lead_assignment_events_select on public.field_visit_lead_assignment_events for select to authenticated
  using (assigned_to = (select private.my_id()) or private.can_view_customer(lead_id));

-- a Field Visit employee: the people Field Visit is for (private.lead_scope_allowed(), for any profile)
create or replace function private.is_field_visit_employee(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                  where p.id = p_profile and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and t.division = 'SALES'
                    and (p.sales_sub_role is null or p.sales_sub_role in ('TELECALLER', 'BUSINESS_ASSOCIATE')))
$$;
revoke all on function private.is_field_visit_employee(uuid) from public, anon;
grant execute on function private.is_field_visit_employee(uuid) to authenticated, service_role;

-- the Sales Department Heads who decide a lead of this department and team (not Operations Heads: they oversee, the head assigns)
create or replace function private.field_visit_lead_heads(p_department uuid, p_team uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select h.id from public.profiles h
   where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and not h.is_operations_head
     and private.head_covers(h.id, private.base_department(p_department), p_team)
$$;
revoke all on function private.field_visit_lead_heads(uuid, uuid) from public, anon, authenticated;

create or replace function private.tg_customers_field_visit_route()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  h uuid;
begin
  if new.lifecycle_stage = 'LEAD' and lower(btrim(coalesce(new.lead_source, ''))) = 'field visit'
     and new.created_by is not null and private.is_field_visit_employee(new.created_by)
     and exists (select 1 from public.teams t where t.id = new.team_id and t.division = 'SALES') then
    insert into public.field_visit_lead_routes (lead_id, department_id, created_by) values (new.id, new.department_id, new.created_by)
    on conflict (lead_id) do nothing;
    if found then
      insert into public.customer_activities (customer_id, actor_id, type, note)
      values (new.id, new.created_by, 'FIELD_VISIT_LEAD_SUBMITTED', 'Added on a field visit; waiting for the Sales Department Head to assign a Telecaller');
      for h in select private.field_visit_lead_heads(new.department_id, new.team_id) loop
        perform private.notify(h, 'FIELD_VISIT_LEAD_PENDING', format('Field visit lead: %s', coalesce(nullif(new.company, ''), new.name)),
          format('%s added %s on a field visit. Assign it to a Telecaller.', (select full_name from public.profiles where id = new.created_by), new.name),
          'customer', new.id);
      end loop;
      perform private.write_audit('FIELD_VISIT_LEAD_SUBMITTED', 'customer', new.id, new.department_id, new.team_id, jsonb_build_object('createdBy', new.created_by));
    end if;
  end if;
  return null;
end $$;
revoke all on function private.tg_customers_field_visit_route() from public, anon, authenticated;
drop trigger if exists customers_field_visit_route on public.customers;
create trigger customers_field_visit_route after insert on public.customers for each row execute function private.tg_customers_field_visit_route();

-- While a Field Visit lead waits for the head, the person who added it (or their Team Lead / colleagues) cannot hand it on, move it on or
-- send it to Accounts: that is the head's decision. A head, the Super Admin or a system job (offboarding) may still change the owner;
-- the route then records that person as the assignee.
create or replace function private.tg_customers_field_visit_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.field_visit_lead_routes;
  v_role public.app_role;
begin
  if coalesce(current_setting('crm.field_visit_assign', true), '') = 'on' then return new; end if;
  if new.owner_id is not distinct from old.owner_id and new.lifecycle_stage is not distinct from old.lifecycle_stage
     and new.payment_workflow is not distinct from old.payment_workflow then
    return new;
  end if;
  select * into r from public.field_visit_lead_routes where lead_id = old.id and status = 'PENDING' for update;
  if r.lead_id is null then return new; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if auth.uid() is not null and (v_role is null or v_role in ('TEAM_MEMBER', 'TEAM_HEAD')) then
    raise exception 'CONFLICT: This field visit lead is waiting for the Sales Department Head to assign it to a Telecaller.' using errcode = 'P0001';
  end if;
  if new.owner_id is distinct from old.owner_id then
    update public.field_visit_lead_routes set status = 'ASSIGNED', assigned_to = new.owner_id, assigned_by = auth.uid(), assigned_at = now() where lead_id = r.lead_id;
    insert into public.field_visit_lead_assignment_events (lead_id, assigned_to, assigned_by, previous_owner, note)
    values (old.id, new.owner_id, auth.uid(), old.owner_id, 'Owner changed outside the Field Visit queue');
  end if;
  return new;
end $$;
revoke all on function private.tg_customers_field_visit_guard() from public, anon, authenticated;
drop trigger if exists customers_field_visit_guard on public.customers;
create trigger customers_field_visit_guard before update on public.customers for each row execute function private.tg_customers_field_visit_guard();

-- ---------------------------------------------------------------------------
-- 2b. The Sales Department Head's queue, the Telecallers they may choose, and the assignment
-- ---------------------------------------------------------------------------
create or replace function private.require_field_visit_lead_head()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE' and role = 'DEPARTMENT_HEAD' and not is_operations_head;
  if me.id is null then raise exception 'FORBIDDEN: Field visit leads are assigned by the Sales Department Head.' using errcode = '42501'; end if;
  return me;
end $$;
revoke all on function private.require_field_visit_lead_head() from public, anon, authenticated;

create or replace function private.field_visit_route_json(r public.field_visit_lead_routes)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'leadId', c.id, 'name', c.name, 'company', c.company, 'phone', c.phone, 'whatsapp', c.whatsapp, 'email', c.email, 'city', c.city,
    'address', c.address, 'businessCategory', c.business_category, 'leadSource', c.lead_source, 'notes', c.notes, 'stage', c.lifecycle_stage,
    'department', (select d.name from public.departments d where d.id = c.department_id),
    'services', coalesce((select jsonb_agg(cs.name order by cs.name) from public.customer_services s join public.crm_services cs on cs.code = s.service_code where s.customer_id = c.id), '[]'::jsonb),
    'status', r.status, 'createdAt', r.created_at,
    'createdBy', (select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'role', case p.sales_sub_role when 'TELECALLER' then 'Telecaller' when 'BUSINESS_ASSOCIATE' then 'Business Associate' else 'Sales Team Member' end)
                    from public.profiles p where p.id = r.created_by),
    'assignedTo', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = r.assigned_to),
    'assignedBy', (select p.full_name from public.profiles p where p.id = r.assigned_by), 'assignedAt', r.assigned_at,
    'history', coalesce((select jsonb_agg(jsonb_build_object('assignedTo', (select p.full_name from public.profiles p where p.id = ev.assigned_to),
                                                             'assignedBy', (select p.full_name from public.profiles p where p.id = ev.assigned_by),
                                                             'at', ev.created_at, 'note', ev.note) order by ev.created_at)
                           from public.field_visit_lead_assignment_events ev where ev.lead_id = c.id), '[]'::jsonb))
  from public.customers c where c.id = r.lead_id
$$;
revoke all on function private.field_visit_route_json(public.field_visit_lead_routes) from public, anon, authenticated;

create or replace function public.field_visit_lead_queue(p_status text default 'PENDING', p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_field_visit_lead_head();
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
begin
  if p_status is null or p_status not in ('PENDING', 'ASSIGNED', 'ALL') then raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001'; end if;
  return (
    with mine as (
      select r.*, c.created_at as lead_created from public.field_visit_lead_routes r join public.customers c on c.id = r.lead_id
       where private.head_covers(me.id, private.base_department(c.department_id), c.team_id)
         and (p_status = 'ALL' or r.status = p_status)
         and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.city, ''))) > 0))
    select jsonb_build_object(
      'total', (select count(*) from mine), 'page', v_page, 'pageSize', v_size,
      'pending', (select count(*) from public.field_visit_lead_routes r join public.customers c on c.id = r.lead_id
                   where r.status = 'PENDING' and private.head_covers(me.id, private.base_department(c.department_id), c.team_id)),
      'items', coalesce((select jsonb_agg(private.field_visit_route_json(row(m.lead_id, m.department_id, m.created_by, m.status, m.assigned_to, m.assigned_by, m.assigned_at, m.created_at, m.updated_at)::public.field_visit_lead_routes)
                                          order by m.created_at desc, m.lead_id)
                           from (select * from mine order by created_at desc, lead_id limit v_size offset (v_page - 1) * v_size) m), '[]'::jsonb)));
end $$;
revoke all on function public.field_visit_lead_queue(text, text, integer, integer) from public, anon;
grant execute on function public.field_visit_lead_queue(text, text, integer, integer) to authenticated;

-- the active Telecallers of the lead's department (and of a Sales team the head covers)
create or replace function public.field_visit_lead_telecallers(p_lead uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_field_visit_lead_head();
  c public.customers;
begin
  select cu.* into c from public.customers cu join public.field_visit_lead_routes r on r.lead_id = cu.id where cu.id = p_lead;
  if c.id is null or not private.head_covers(me.id, private.base_department(c.department_id), c.team_id) then raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'team', t.name,
                        'openLeads', (select count(*) from public.customers x where x.owner_id = p.id and x.lifecycle_stage = 'LEAD')) order by p.full_name)
                     from public.profiles p join public.teams t on t.id = p.team_id
                    where p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and p.sales_sub_role = 'TELECALLER' and t.division = 'SALES'
                      and private.base_department(p.department_id) = private.base_department(c.department_id)
                      and private.head_covers(me.id, private.base_department(p.department_id), p.team_id)), '[]'::jsonb);
end $$;
revoke all on function public.field_visit_lead_telecallers(uuid) from public, anon;
grant execute on function public.field_visit_lead_telecallers(uuid) to authenticated;

create or replace function public.field_visit_lead_assign(p_lead uuid, p_telecaller uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_field_visit_lead_head();
  r public.field_visit_lead_routes;
  c public.customers;
  a public.profiles;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  if length(coalesce(p_note, '')) > 500 then raise exception 'VALIDATION_ERROR: The note is too long (500 characters at most).' using errcode = 'P0001'; end if;
  select * into r from public.field_visit_lead_routes where lead_id = p_lead for update;
  select * into c from public.customers where id = p_lead for update;
  if r.lead_id is null or c.id is null or not private.head_covers(me.id, private.base_department(c.department_id), c.team_id) then
    raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001';
  end if;
  if c.lifecycle_stage <> 'LEAD' then raise exception 'CONFLICT: This is no longer a lead.' using errcode = 'P0001'; end if;
  select p.* into a from public.profiles p join public.teams t on t.id = p.team_id
   where p.id = p_telecaller and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and p.sales_sub_role = 'TELECALLER' and t.division = 'SALES'
     and private.base_department(p.department_id) = private.base_department(c.department_id)
     and private.head_covers(me.id, private.base_department(p.department_id), p.team_id);
  if a.id is null then raise exception 'VALIDATION_ERROR: Choose an active Telecaller of this department.' using errcode = 'P0001'; end if;
  -- a retry (or a second click) of the same assignment changes nothing
  if r.status = 'ASSIGNED' and r.assigned_to = a.id and c.owner_id = a.id then
    return private.field_visit_route_json(r) || jsonb_build_object('changed', false);
  end if;
  perform set_config('crm.field_visit_assign', 'on', true);
  update public.customers set owner_id = a.id where id = c.id;
  perform set_config('crm.field_visit_assign', '', true);
  update public.field_visit_lead_routes set status = 'ASSIGNED', assigned_to = a.id, assigned_by = me.id, assigned_at = now() where lead_id = r.lead_id returning * into r;
  insert into public.field_visit_lead_assignment_events (lead_id, assigned_to, assigned_by, previous_owner, note) values (c.id, a.id, me.id, c.owner_id, v_note);
  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'FIELD_VISIT_LEAD_ASSIGNED', format('Assigned to %s by %s%s', a.full_name, me.full_name, coalesce(': ' || v_note, '')));
  perform private.notify(a.id, 'LEAD_ASSIGNED', 'New lead assigned', format('%s (from a field visit) was assigned to you by %s.%s', c.name, me.full_name, coalesce(' ' || v_note, '')), 'customer', c.id);
  if r.created_by is not null and r.created_by <> a.id then
    perform private.notify(r.created_by, 'FIELD_VISIT_LEAD_ASSIGNED', format('%s was assigned', c.name), format('Your field visit lead went to %s.', a.full_name), 'customer', c.id);
  end if;
  perform private.write_audit('FIELD_VISIT_LEAD_ASSIGNED_TO_TELECALLER', 'customer', c.id, c.department_id, c.team_id,
    jsonb_build_object('telecaller', a.id, 'previousOwner', c.owner_id, 'createdBy', r.created_by));
  return private.field_visit_route_json(r) || jsonb_build_object('changed', true);
end $$;
revoke all on function public.field_visit_lead_assign(uuid, uuid, text) from public, anon;
grant execute on function public.field_visit_lead_assign(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A lead create that a retry cannot duplicate
-- ---------------------------------------------------------------------------
create table if not exists public.lead_create_requests (
  created_by uuid not null references public.profiles (id) on delete cascade,
  client_request_id uuid not null,
  customer_id uuid not null references public.customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (created_by, client_request_id)
);
create index if not exists lead_create_requests_customer_idx on public.lead_create_requests (customer_id);
alter table public.lead_create_requests enable row level security;
revoke all on public.lead_create_requests from anon, authenticated;

create or replace function private.lead_request_find(p_request uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select customer_id from public.lead_create_requests where created_by = private.my_id() and client_request_id = p_request
$$;
revoke all on function private.lead_request_find(uuid) from public, anon;
grant execute on function private.lead_request_find(uuid) to authenticated;

create or replace function private.lead_request_record(p_request uuid, p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.customers where id = p_customer and created_by = private.my_id()) then
    raise exception 'FORBIDDEN: Not your lead.' using errcode = '42501';
  end if;
  insert into public.lead_create_requests (created_by, client_request_id, customer_id) values (private.my_id(), p_request, p_customer) on conflict do nothing;
end $$;
revoke all on function private.lead_request_record(uuid, uuid) from public, anon;
grant execute on function private.lead_request_record(uuid, uuid) to authenticated;

-- security invoker: create_lead keeps applying the caller's own row rules; the lock makes two copies of one request wait for each other
create or replace function public.create_lead_once(p_fields jsonb, p_services text[], p_request uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_request is null then raise exception 'VALIDATION_ERROR: A request id is needed.' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(auth.uid()::text, '') || ':' || p_request::text, 0));
  v_id := private.lead_request_find(p_request);
  if v_id is not null then return jsonb_build_object('id', v_id, 'existing', true); end if;
  v_id := public.create_lead(p_fields, p_services);
  perform private.lead_request_record(p_request, v_id);
  return jsonb_build_object('id', v_id, 'existing', false);
end $$;
revoke all on function public.create_lead_once(jsonb, text[], uuid) from public, anon;
grant execute on function public.create_lead_once(jsonb, text[], uuid) to authenticated;
