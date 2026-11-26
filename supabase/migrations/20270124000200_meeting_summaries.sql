-- =============================================================================
-- Post-meeting summaries (Minutes of Meeting) for internal team meetings, and the CEO's Meeting Decisions reports.
--
-- Extends the existing Meetings system (20270101000500 and later); no new meeting module, no new meeting statuses.
--
--   * Which meetings: internal team meetings only = kind 'MEETING', booked by staff (booked_via 'STAFF'), not mirrored from another
--     workflow (source_type null: no Business Associate demo, recruitment interview or employee -> HR meeting) and not a client meeting.
--     Appointments, demos, interviews, HR meetings, client meetings, booking-link bookings and requests for the CEO's time
--     (CEO_MEETING) keep working exactly as before.
--   * Attendance: after the meeting started, the host / the one who booked it / the host's delegates (private.mtg_can_manage: for a
--     meeting the CEO hosts, only a Super Admin) confirm which invited colleagues actually attended. Recorded per person, with who and when.
--   * Who writes the summary: the most senior leader who ATTENDED (Super Admin > Operations Head > Department Head > Team Lead), among
--     the leaders whose own scope covers someone else who attended (or who host / booked the meeting), so a leader from an unrelated
--     department who sat in is never made responsible. Several of the same rank: the host if among them, else the one who booked it,
--     else an organiser or a supervisor picks one of them (mms_assign_owner). Nobody attended who leads: the organiser may prepare a draft
--     and route it to a leader whose scope covers the attendees, or a supervisor / the Super Admin takes it (audited). An owner who was
--     suspended or moved can be replaced the same way. The CEO may delegate their own summary to someone who attended.
--   * Summary statuses (separate from the meeting's own status): PENDING, DRAFT, SUBMITTED, REVISION_REQUESTED, REVISED. Submitting
--     completes the meeting in the same transaction; mtg_complete refuses such a meeting until then. Every submission and amendment is
--     kept as an immutable revision; the CEO's clarification requests and the leader's answers are kept apart and never overwrite it.
--   * Overdue: not submitted <overdue_hours> (default 24) after the meeting ended. Meetings that ended before this feature started are
--     "historical": never pending or overdue; a leader may still add a summary after confirming attendance.
--   * Reading: the owner and the organisers (everything, drafts too); once submitted also the Super Admin (company wide, outcome fields
--     only, never guests or private calendar details), the Operations Head / Department Head whose scope covers the owner's department
--     and function, the Team Lead of the owner's team, everyone who attended, and the people given an action item.
--
-- Additive and safe to run twice; no temp tables; nothing existing is deleted. Replaces public.mtg_complete (same signature) with its
-- previous definition plus the summary check.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.meeting_summary_settings (
  id boolean primary key default true check (id),
  overdue_hours integer not null default 24 check (overdue_hours between 1 and 168),
  -- meetings that ended before this are historical: a summary is optional and never overdue
  active_from timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.meeting_summary_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.meeting_summary_attendance (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attended boolean not null,
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  primary key (meeting_id, profile_id)
);
create index if not exists meeting_summary_attendance_profile_idx on public.meeting_summary_attendance (profile_id) where attended;

create table if not exists public.meeting_summaries (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.meetings (id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'DRAFT', 'SUBMITTED', 'REVISION_REQUESTED', 'REVISED')),
  owner_id uuid references public.profiles (id) on delete set null,
  owner_method text check (owner_method is null or owner_method in
    ('SENIORITY', 'HOST', 'CREATOR', 'SELECTED', 'DELEGATED', 'TRANSFERRED', 'ROUTED', 'ESCALATED', 'NO_LEADER', 'SELECTION_REQUIRED')),
  owner_reason text check (owner_reason is null or length(owner_reason) <= 500),
  owner_assigned_by uuid references public.profiles (id) on delete set null,
  owner_assigned_at timestamptz,
  selection_rank smallint,
  selection_candidates uuid[] not null default '{}',
  -- the unit the report belongs to (the owner's, else the host's): who supervises it
  scope_department_id uuid references public.departments (id) on delete set null,
  scope_division text check (scope_division is null or scope_division in ('SALES', 'SUPPORT')),
  scope_team_id uuid references public.teams (id) on delete set null,
  attendance_confirmed_at timestamptz,
  attendance_confirmed_by uuid references public.profiles (id) on delete set null,
  purpose_note text check (purpose_note is null or length(purpose_note) <= 1000),
  executive_summary text check (executive_summary is null or length(executive_summary) <= 8000),
  discussion_points jsonb not null default '[]'::jsonb check (jsonb_typeof(discussion_points) = 'array'),
  no_decisions boolean not null default false,
  no_blockers boolean not null default false,
  next_steps text check (next_steps is null or length(next_steps) <= 4000),
  follow_up_required boolean not null default false,
  follow_up_date date,
  follow_up_outcome text check (follow_up_outcome is null or length(follow_up_outcome) <= 1000),
  drafted_by uuid references public.profiles (id) on delete set null,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  first_submitted_at timestamptz,
  revision_no integer not null default 0,
  is_historical boolean not null default false,
  version integer not null default 1,
  pending_notified_at timestamptz,
  owner_notified_id uuid,
  overdue_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meeting_summaries_owner_idx on public.meeting_summaries (owner_id, status);
create index if not exists meeting_summaries_status_idx on public.meeting_summaries (status, submitted_at desc);
create index if not exists meeting_summaries_scope_idx on public.meeting_summaries (scope_department_id, scope_division);
create index if not exists meeting_summaries_team_idx on public.meeting_summaries (scope_team_id) where scope_team_id is not null;

create table if not exists public.meeting_summary_decisions (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.meeting_summaries (id) on delete cascade,
  client_key uuid not null,
  position integer not null default 0,
  title text not null check (length(btrim(title)) between 2 and 200),
  description text check (description is null or length(description) <= 2000),
  department_id uuid references public.departments (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  status text not null default 'APPROVED' check (status in ('PROPOSED', 'APPROVED', 'IN_PROGRESS', 'IMPLEMENTED', 'ON_HOLD')),
  ceo_follow_up boolean not null default false,
  ceo_follow_up_note text check (ceo_follow_up_note is null or length(ceo_follow_up_note) <= 1000),
  ceo_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (summary_id, client_key)
);
create index if not exists meeting_summary_decisions_followup_idx on public.meeting_summary_decisions (summary_id) where ceo_follow_up;

create table if not exists public.meeting_summary_actions (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.meeting_summaries (id) on delete cascade,
  client_key uuid not null,
  position integer not null default 0,
  title text not null check (length(btrim(title)) between 2 and 200),
  description text check (description is null or length(description) <= 2000),
  assignee_id uuid not null references public.profiles (id) on delete restrict,
  due_date date,
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  status text not null default 'PENDING' check (status in ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED')),
  decision_key uuid,
  -- reserved for a link to a work task (see docs/MEETING_SUMMARIES.md): not set by this migration
  task_id uuid,
  completed_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (summary_id, client_key)
);
create index if not exists meeting_summary_actions_assignee_idx on public.meeting_summary_actions (assignee_id, status);
create index if not exists meeting_summary_actions_due_idx on public.meeting_summary_actions (due_date) where status in ('PENDING', 'IN_PROGRESS', 'BLOCKED');

create table if not exists public.meeting_summary_blockers (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.meeting_summaries (id) on delete cascade,
  client_key uuid not null,
  position integer not null default 0,
  category text not null default 'OTHER'
    check (category in ('PENDING_APPROVAL', 'RESOURCE', 'OPERATIONAL', 'CUSTOMER_ESCALATION', 'DEPENDENCY', 'CEO_DECISION', 'OTHER')),
  description text not null check (length(btrim(description)) between 2 and 2000),
  needs_ceo_attention boolean not null default false,
  ceo_follow_up boolean not null default false,
  ceo_follow_up_note text check (ceo_follow_up_note is null or length(ceo_follow_up_note) <= 1000),
  ceo_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (summary_id, client_key)
);
create index if not exists meeting_summary_blockers_attention_idx on public.meeting_summary_blockers (summary_id) where needs_ceo_attention or ceo_follow_up;

-- immutable: each submission and amendment as it was
create table if not exists public.meeting_summary_revisions (
  id bigint generated always as identity primary key,
  summary_id uuid not null references public.meeting_summaries (id) on delete cascade,
  revision_no integer not null,
  kind text not null check (kind in ('SUBMITTED', 'REVISED')),
  change_note text check (change_note is null or length(change_note) <= 1000),
  snapshot jsonb not null,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (summary_id, revision_no)
);

-- the CEO's clarification requests and follow-up marks, and the leader's answers (append-only)
create table if not exists public.meeting_summary_comments (
  id bigint generated always as identity primary key,
  summary_id uuid not null references public.meeting_summaries (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('CLARIFICATION', 'RESPONSE', 'FOLLOW_UP')),
  body text not null check (length(btrim(body)) between 2 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists meeting_summary_comments_summary_idx on public.meeting_summary_comments (summary_id, id);

-- every step (attendance, owner, draft, submission, action-item update) (append-only)
create table if not exists public.meeting_summary_events (
  id bigint generated always as identity primary key,
  summary_id uuid not null references public.meeting_summaries (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind ~ '^[A-Z][A-Z_]{1,40}$'),
  note text check (note is null or length(note) <= 1000),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists meeting_summary_events_summary_idx on public.meeting_summary_events (summary_id, id);

-- no direct access: everything goes through the functions below
do $$
declare
  t text;
begin
  foreach t in array array['meeting_summary_settings', 'meeting_summary_attendance', 'meeting_summaries', 'meeting_summary_decisions',
                           'meeting_summary_actions', 'meeting_summary_blockers', 'meeting_summary_revisions', 'meeting_summary_comments',
                           'meeting_summary_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

create or replace function private.tg_mms_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: Meeting summary history cannot be changed.' using errcode = '42501';
end $$;
drop trigger if exists meeting_summary_revisions_append_only on public.meeting_summary_revisions;
create trigger meeting_summary_revisions_append_only before update or delete on public.meeting_summary_revisions
  for each row when (pg_trigger_depth() = 0) execute function private.tg_mms_append_only();
drop trigger if exists meeting_summary_comments_append_only on public.meeting_summary_comments;
create trigger meeting_summary_comments_append_only before update or delete on public.meeting_summary_comments
  for each row when (pg_trigger_depth() = 0) execute function private.tg_mms_append_only();
drop trigger if exists meeting_summary_events_append_only on public.meeting_summary_events;
create trigger meeting_summary_events_append_only before update or delete on public.meeting_summary_events
  for each row when (pg_trigger_depth() = 0) execute function private.tg_mms_append_only();

-- ---------------------------------------------------------------------------
-- 2. Helpers: eligibility, rank, scope
-- ---------------------------------------------------------------------------
create or replace function private.mms_eligible(m public.meetings)
returns boolean language sql immutable set search_path = '' as $$
  select m.kind = 'MEETING' and m.source_type is null and m.booked_via = 'STAFF' and m.client_company is null
$$;

-- Super Admin 4, Operations Head 3, Department Head 2, Team Lead 1, anyone else 0 (only active accounts rank)
create or replace function private.mms_rank(p_profile uuid)
returns smallint language sql stable security definer set search_path = '' as $$
  select coalesce((select case when p.role = 'SUPER_ADMIN' then 4
                               when p.role = 'DEPARTMENT_HEAD' and p.is_operations_head then 3
                               when p.role = 'DEPARTMENT_HEAD' then 2
                               when p.role = 'TEAM_HEAD' then 1 else 0 end
                     from public.profiles p where p.id = p_profile and p.status = 'ACTIVE'), 0)::smallint
$$;

create or replace function private.mms_rank_label(p_rank integer)
returns text language sql immutable set search_path = '' as $$
  select case p_rank when 4 then 'CEO' when 3 then 'Operations Head' when 2 then 'Department Head' when 1 then 'Team Lead' else 'Team Member' end
$$;

-- the Sales / Support function a person works in (null = the whole department or not split)
create or replace function private.mms_division_of(p_profile uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when p.role = 'DEPARTMENT_HEAD' then p.head_division
              else (select nullif(t.division::text, 'GENERAL') from public.teams t where t.id = p.team_id) end
    from public.profiles p where p.id = p_profile
$$;

-- does this leader's own scope cover that person? (Operations / Department Head: their departments and function; Team Lead: their team)
create or replace function private.mms_covers(p_leader uuid, p_person uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_rank smallint := private.mms_rank(p_leader);
  p public.profiles;
begin
  select * into p from public.profiles where id = p_person and status = 'ACTIVE';
  if p.id is null or v_rank = 0 then
    return false;
  end if;
  if v_rank = 4 then
    return true;
  end if;
  if p.role = 'SUPER_ADMIN' or p.department_id is null then
    return false;
  end if;
  if v_rank = 1 then
    return p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and p.team_id is not null
       and p.team_id = (select l.team_id from public.profiles l where l.id = p_leader);
  end if;
  return private.scope_covers(p_leader, p.department_id, private.mms_division_of(p.id));
end $$;

-- who attended (confirmed, still active)
create or replace function private.mms_attending(p_meeting uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.profile_id order by a.profile_id), '{}')
    from public.meeting_summary_attendance a join public.profiles p on p.id = a.profile_id and p.status = 'ACTIVE'
   where a.meeting_id = p_meeting and a.attended
$$;

-- the responsible leader, from the people who actually attended
create or replace function private.mms_pick_owner(m public.meetings)
returns table (owner_id uuid, method text, rank smallint, candidates uuid[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_att uuid[] := private.mms_attending(m.id);
  v_rank integer;
  v_cands uuid[];
begin
  for v_rank in reverse 4..1 loop
    select coalesce(array_agg(x order by x), '{}') into v_cands
      from unnest(v_att) x
     where private.mms_rank(x) = v_rank
       and (x = m.host_id or x = m.created_by
            or exists (select 1 from unnest(v_att) y where y <> x and private.mms_covers(x, y)));
    if cardinality(v_cands) = 1 then
      return query select v_cands[1], 'SENIORITY'::text, v_rank::smallint, v_cands;
      return;
    elsif cardinality(v_cands) > 1 then
      if m.host_id = any (v_cands) then
        return query select m.host_id, 'HOST'::text, v_rank::smallint, v_cands;
      elsif m.created_by = any (v_cands) then
        return query select m.created_by, 'CREATOR'::text, v_rank::smallint, v_cands;
      else
        return query select null::uuid, 'SELECTION_REQUIRED'::text, v_rank::smallint, v_cands;
      end if;
      return;
    end if;
  end loop;
  return query select null::uuid, 'NO_LEADER'::text, 0::smallint, '{}'::uuid[];
end $$;

-- the unit a report belongs to: the owner's (or, without an owner, the host's) department, function and team
create or replace function private.mms_set_scope(p_summary uuid, p_profile uuid)
returns void language sql security definer set search_path = '' as $$
  update public.meeting_summaries s
     set scope_department_id = case when p.role = 'SUPER_ADMIN' then null else private.base_department(p.department_id) end,
         scope_division = case when p.role = 'SUPER_ADMIN' then null else private.mms_division_of(p.id) end,
         scope_team_id = case when p.role in ('TEAM_HEAD', 'TEAM_MEMBER') then p.team_id end
    from public.profiles p
   where s.id = p_summary and p.id = p_profile
$$;

-- a supervisor of the report's unit (not its own author): the Super Admin; an Operations / Department Head whose scope covers the
-- unit's department and function; the Team Lead of the unit's team
create or replace function private.mms_supervises(p_profile uuid, s public.meeting_summaries)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_rank smallint := private.mms_rank(p_profile);
begin
  if v_rank = 4 then
    return true;
  elsif v_rank in (2, 3) then
    return s.scope_department_id is not null and private.scope_covers(p_profile, s.scope_department_id, s.scope_division);
  elsif v_rank = 1 then
    return s.scope_team_id is not null and s.scope_team_id = (select p.team_id from public.profiles p where p.id = p_profile);
  end if;
  return false;
end $$;

create or replace function private.mms_settings()
returns public.meeting_summary_settings language sql stable security definer set search_path = '' as $$
  select * from public.meeting_summary_settings where id
$$;

create or replace function private.mms_due_at(m public.meetings)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select m.ends_at + make_interval(hours => coalesce((select x.overdue_hours from public.meeting_summary_settings x where x.id), 24))
$$;

create or replace function private.mms_overdue(s public.meeting_summaries, m public.meetings)
returns boolean language sql stable security definer set search_path = '' as $$
  select s.status in ('PENDING', 'DRAFT') and not s.is_historical and m.status in ('SCHEDULED', 'COMPLETED')
     and now() > private.mms_due_at(m)
$$;

create or replace function private.mms_event(p_summary uuid, p_kind text, p_note text default null, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.meeting_summary_events (summary_id, actor_id, kind, note, data)
  values (p_summary, auth.uid(), p_kind, left(p_note, 1000), coalesce(p_data, '{}'::jsonb))
$$;

-- the summary row of an eligible meeting (made the first time it is needed; a meeting booked and ended before summaries started is historical)
create or replace function private.mms_ensure(m public.meetings)
returns public.meeting_summaries language plpgsql security definer set search_path = '' as $$
declare
  s public.meeting_summaries;
begin
  select * into s from public.meeting_summaries where meeting_id = m.id for update;
  if s.id is null then
    insert into public.meeting_summaries (meeting_id, is_historical)
    values (m.id, m.ends_at < (select x.active_from from public.meeting_summary_settings x where x.id)
                  and m.created_at < (select x.active_from from public.meeting_summary_settings x where x.id))
    on conflict (meeting_id) do nothing;
    select * into s from public.meeting_summaries where meeting_id = m.id for update;
    if s.scope_department_id is null and s.owner_id is null then
      perform private.mms_set_scope(s.id, m.host_id);
      select * into s from public.meeting_summaries where id = s.id;
    end if;
  end if;
  return s;
end $$;

-- every new eligible meeting gets its (pending) summary row, so supervisors and the CEO can see what is outstanding
create or replace function private.tg_meetings_summary_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.mms_eligible(new) then
    perform private.mms_ensure(new);
  end if;
  return null;
exception when others then
  raise warning 'meeting summary row not created for %: %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists meetings_summary_row on public.meetings;
create trigger meetings_summary_row after insert on public.meetings for each row execute function private.tg_meetings_summary_row();

-- meetings already planned when this runs get their row now (historical ones only when someone adds a summary)
do $$
declare
  m public.meetings;
begin
  for m in select * from public.meetings x
            where private.mms_eligible(x) and x.status in ('SCHEDULED', 'COMPLETED', 'REQUESTED', 'PROPOSED', 'PENDING_AVAILABILITY')
              and x.ends_at >= (select s.active_from from public.meeting_summary_settings s where s.id)
              and not exists (select 1 from public.meeting_summaries y where y.meeting_id = x.id) loop
    perform private.mms_ensure(m);
  end loop;
end $$;

-- may this person read the content of the report? (drafts: the owner and the organisers only)
create or replace function private.mms_can_read(p_profile uuid, s public.meeting_summaries, m public.meetings)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and (
    s.owner_id is not distinct from p_profile or s.drafted_by is not distinct from p_profile or private.mtg_can_manage(m, p_profile)
    or (s.revision_no > 0 and (
          private.mms_supervises(p_profile, s)
          or exists (select 1 from public.meeting_summary_attendance a where a.meeting_id = m.id and a.profile_id = p_profile and a.attended)
          or exists (select 1 from public.meeting_summary_actions x where x.summary_id = s.id and x.assignee_id = p_profile))))
$$;

-- may this person see that the summary exists and its status (not its content)?
create or replace function private.mms_can_see(p_profile uuid, s public.meeting_summaries, m public.meetings)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.mms_can_read(p_profile, s, m) or private.mtg_can_view(m, p_profile) or private.mms_supervises(p_profile, s)
$$;

-- may the owner (or, before there is one, the organiser preparing a draft) give this person an action item?
create or replace function private.mms_can_assign(p_writer uuid, p_assignee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_assignee and p.status = 'ACTIVE')
     and (p_assignee = p_writer or private.mms_covers(p_writer, p_assignee))
$$;

do $$
declare
  f text;
begin
  foreach f in array array['private.mms_eligible(public.meetings)', 'private.mms_rank(uuid)', 'private.mms_rank_label(integer)',
    'private.mms_division_of(uuid)', 'private.mms_covers(uuid, uuid)', 'private.mms_attending(uuid)', 'private.mms_pick_owner(public.meetings)',
    'private.mms_set_scope(uuid, uuid)', 'private.mms_supervises(uuid, public.meeting_summaries)', 'private.mms_settings()',
    'private.mms_due_at(public.meetings)', 'private.mms_overdue(public.meeting_summaries, public.meetings)',
    'private.mms_event(uuid, text, text, jsonb)', 'private.mms_ensure(public.meetings)', 'private.tg_meetings_summary_row()',
    'private.mms_can_read(uuid, public.meeting_summaries, public.meetings)', 'private.mms_can_see(uuid, public.meeting_summaries, public.meetings)',
    'private.mms_can_assign(uuid, uuid)', 'private.tg_mms_append_only()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. What a report looks like
-- ---------------------------------------------------------------------------
create or replace function private.mms_person(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'rank', private.mms_rank(p.id), 'roleLabel', case when p.status <> 'ACTIVE' then 'Inactive'
      else private.mms_rank_label(private.mms_rank(p.id)) end,
    'position', nullif(btrim(coalesce(p.position, '')), ''), 'active', p.status = 'ACTIVE',
    'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
    'team', (select t.name from public.teams t where t.id = p.team_id)) end
    from (select 1) x left join public.profiles p on p.id = p_profile
$$;

-- the report's content (also the frozen snapshot of each revision)
create or replace function private.mms_content(s public.meeting_summaries)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'purposeNote', s.purpose_note, 'executiveSummary', s.executive_summary, 'discussionPoints', s.discussion_points,
    'noDecisions', s.no_decisions, 'noBlockers', s.no_blockers, 'nextSteps', s.next_steps,
    'followUp', jsonb_build_object('required', s.follow_up_required, 'date', s.follow_up_date, 'outcome', s.follow_up_outcome),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'key', d.client_key, 'title', d.title, 'description', d.description,
        'departmentId', d.department_id, 'department', (select x.name from public.departments x where x.id = d.department_id),
        'teamId', d.team_id, 'team', (select t.name from public.teams t where t.id = d.team_id),
        'decidedBy', d.decided_by, 'decidedByName', (select p.full_name from public.profiles p where p.id = d.decided_by),
        'status', d.status, 'ceoFollowUp', d.ceo_follow_up, 'ceoFollowUpNote', d.ceo_follow_up_note) order by d.position, d.created_at)
        from public.meeting_summary_decisions d where d.summary_id = s.id), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'key', a.client_key, 'title', a.title, 'description', a.description,
        'assigneeId', a.assignee_id, 'assigneeName', (select p.full_name from public.profiles p where p.id = a.assignee_id),
        'dueDate', a.due_date, 'priority', a.priority, 'status', a.status, 'decisionKey', a.decision_key,
        'overdue', a.status in ('PENDING', 'IN_PROGRESS', 'BLOCKED') and a.due_date < (now() at time zone 'Asia/Kolkata')::date,
        'completedAt', a.completed_at, 'updatedAt', a.updated_at) order by a.position, a.created_at)
        from public.meeting_summary_actions a where a.summary_id = s.id), '[]'::jsonb),
    'blockers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'key', b.client_key, 'category', b.category, 'description', b.description,
        'needsCeoAttention', b.needs_ceo_attention, 'ceoFollowUp', b.ceo_follow_up, 'ceoFollowUpNote', b.ceo_follow_up_note)
        order by b.position, b.created_at)
        from public.meeting_summary_blockers b where b.summary_id = s.id), '[]'::jsonb))
$$;

-- one meeting's summary as the viewer may see it. Only outcome fields of the meeting: never guests, links or locations.
create or replace function private.mms_detail(m public.meetings, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.meeting_summaries;
  v_eligible boolean := private.mms_eligible(m);
  v_manager boolean := m.source_type is null and private.mtg_can_manage(m, p_viewer);
  v_rank smallint := private.mms_rank(p_viewer);
  v_started boolean := m.starts_at <= now();
  v_done boolean;
  v_read boolean := false;
  v_can_edit boolean := false;
  v_can_submit boolean := false;
  v_can_assign boolean := false;
  v_writer uuid;
  v_out jsonb;
begin
  select * into s from public.meeting_summaries where meeting_id = m.id;
  v_done := s.id is not null and s.status in ('SUBMITTED', 'REVISION_REQUESTED', 'REVISED');
  if s.id is not null then
    v_read := private.mms_can_read(p_viewer, s, m);
    v_can_edit := not v_done and v_started and m.status in ('SCHEDULED', 'COMPLETED')
                  and (s.owner_id is not distinct from p_viewer or (s.owner_id is null and v_manager));
    v_can_submit := v_started and m.status in ('SCHEDULED', 'COMPLETED') and s.owner_id is not distinct from p_viewer and s.attendance_confirmed_at is not null;
    v_can_assign := not v_done and s.attendance_confirmed_at is not null
                    and (v_manager or v_rank = 4 or (v_rank in (2, 3) and private.mms_supervises(p_viewer, s)));
    v_writer := coalesce(s.owner_id, case when v_can_edit then p_viewer end);
  end if;
  v_out := jsonb_build_object(
    'meetingId', m.id, 'eligible', v_eligible, 'started', v_started, 'ended', m.ends_at <= now(),
    'meeting', jsonb_build_object(
      'id', m.id, 'reference', m.reference, 'title', m.title, 'purpose', m.description, 'kind', m.kind, 'status', m.status,
      'startsAt', m.starts_at, 'endsAt', m.ends_at, 'timezone', m.timezone,
      'department', (select d.name from public.departments d where d.id = s.scope_department_id),
      'departmentId', s.scope_department_id, 'division', s.scope_division,
      'team', (select t.name from public.teams t where t.id = s.scope_team_id),
      'host', private.mms_person(m.host_id), 'organiser', private.mms_person(m.created_by)),
    'attendance', coalesce((select jsonb_agg(private.mms_person(x) || jsonb_build_object(
        'invited', true,
        'response', (select a.response from public.meeting_attendees a where a.meeting_id = m.id and a.profile_id = x),
        'attended', (select t.attended from public.meeting_summary_attendance t where t.meeting_id = m.id and t.profile_id = x))
        order by private.mms_rank(x) desc, (select p.full_name from public.profiles p where p.id = x))
        from unnest(private.mtg_staff_ids(m)) x), '[]'::jsonb),
    'can', jsonb_build_object(
      'confirmAttendance', v_eligible and v_manager and v_started and m.status in ('SCHEDULED', 'COMPLETED') and not v_done,
      'edit', v_can_edit, 'submit', v_can_submit, 'amend', v_can_submit and v_done, 'assignOwner', v_can_assign,
      'clarify', v_rank = 4 and s.status in ('SUBMITTED', 'REVISED'),
      'flag', v_rank = 4 and coalesce(s.revision_no, 0) > 0,
      'reply', coalesce(s.revision_no, 0) > 0 and (s.owner_id is not distinct from p_viewer or s.submitted_by is not distinct from p_viewer),
      'updateActions', coalesce(s.revision_no, 0) > 0 and (s.owner_id is not distinct from p_viewer)),
    'summary', null);
  if s.id is null then
    return v_out;
  end if;
  v_out := jsonb_set(v_out, '{summary}', jsonb_build_object(
    'id', s.id, 'status', s.status, 'overdue', private.mms_overdue(s, m), 'dueAt', private.mms_due_at(m), 'isHistorical', s.is_historical,
    'owner', private.mms_person(s.owner_id), 'ownerMethod', s.owner_method, 'ownerReason', s.owner_reason,
    'ownerAssignedBy', (select p.full_name from public.profiles p where p.id = s.owner_assigned_by), 'ownerAssignedAt', s.owner_assigned_at,
    'selectionRequired', s.owner_method = 'SELECTION_REQUIRED',
    'candidates', coalesce((select jsonb_agg(private.mms_person(x)) from unnest(s.selection_candidates) x), '[]'::jsonb),
    'attendanceConfirmedAt', s.attendance_confirmed_at,
    'attendanceConfirmedBy', (select p.full_name from public.profiles p where p.id = s.attendance_confirmed_by),
    'revisionNo', s.revision_no, 'version', s.version, 'submittedAt', s.submitted_at, 'firstSubmittedAt', s.first_submitted_at,
    'submittedBy', (select p.full_name from public.profiles p where p.id = s.submitted_by),
    'updatedAt', s.updated_at,
    'canRead', v_read,
    'content', case when v_read then private.mms_content(s) end,
    'comments', case when v_read then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'body', c.body,
        'author', (select p.full_name from public.profiles p where p.id = c.author_id), 'createdAt', c.created_at) order by c.id)
        from public.meeting_summary_comments c where c.summary_id = s.id), '[]'::jsonb) end,
    'revisions', case when v_read and (s.owner_id is not distinct from p_viewer or v_manager or private.mms_supervises(p_viewer, s)) then
        coalesce((select jsonb_agg(jsonb_build_object('revisionNo', r.revision_no, 'kind', r.kind, 'changeNote', r.change_note,
          'actor', (select p.full_name from public.profiles p where p.id = r.actor_id), 'createdAt', r.created_at, 'snapshot', r.snapshot)
          order by r.revision_no desc) from public.meeting_summary_revisions r where r.summary_id = s.id), '[]'::jsonb) end,
    'history', case when v_read then coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'note', e.note,
        'actor', (select p.full_name from public.profiles p where p.id = e.actor_id), 'createdAt', e.created_at) order by e.id desc)
        from (select * from public.meeting_summary_events e2 where e2.summary_id = s.id order by e2.id desc limit 50) e), '[]'::jsonb) end,
    -- the people this report's writer may give an action item to, and the leaders it may be handed to
    'assignable', case when v_writer is not null and (v_can_edit or v_can_submit) then
        coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'roleLabel', private.mms_rank_label(private.mms_rank(p.id)))
          order by p.full_name) from public.profiles p
          where p.status = 'ACTIVE' and (p.id = v_writer or private.mms_covers(v_writer, p.id))), '[]'::jsonb) end,
    'routeTargets', case when v_can_assign then
        coalesce((select jsonb_agg(private.mms_person(p.id) order by private.mms_rank(p.id) desc, p.full_name) from public.profiles p
          where p.status = 'ACTIVE' and private.mms_rank(p.id) >= 1 and p.id is distinct from s.owner_id
            and (p.id = any (private.mms_attending(m.id))
                 or exists (select 1 from unnest(private.mms_attending(m.id)) y where y <> p.id and private.mms_covers(p.id, y)))), '[]'::jsonb) end));
  return v_out;
end $$;
revoke all on function private.mms_person(uuid), private.mms_content(public.meeting_summaries), private.mms_detail(public.meetings, uuid)
  from public, anon, authenticated;

-- the meeting, locked, for a summary change by the signed-in employee
create or replace function private.mms_meeting_for(p_meeting uuid, p_me uuid)
returns public.meetings language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  s public.meeting_summaries;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  select * into s from public.meeting_summaries where meeting_id = m.id;
  if not (private.mtg_can_view(m, p_me) or (s.id is not null and private.mms_can_see(p_me, s, m))) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if not private.mms_eligible(m) then
    raise exception 'VALIDATION_ERROR: Summaries are kept for internal team meetings only.' using errcode = 'P0001';
  end if;
  return m;
end $$;
revoke all on function private.mms_meeting_for(uuid, uuid) from public, anon, authenticated;

-- notify the responsible leader once per owner
create or replace function private.mms_notify_owner(s public.meeting_summaries, m public.meetings)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if s.owner_id is null or s.owner_notified_id is not distinct from s.owner_id or s.status not in ('PENDING', 'DRAFT') then
    return;
  end if;
  perform private.notify(s.owner_id, 'MEETING_SUMMARY_PENDING', 'Meeting summary pending: ' || m.title,
    'You are responsible for the summary of this meeting (' || private.mtg_when(m.starts_at, m.timezone)
      || '). Please document the decisions and next steps.', 'meeting', m.id, jsonb_build_object('meetingId', m.id, 'summary', true), 'normal');
  update public.meeting_summaries set owner_notified_id = s.owner_id where id = s.id;
end $$;
revoke all on function private.mms_notify_owner(public.meeting_summaries, public.meetings) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading one summary
-- ---------------------------------------------------------------------------
create or replace function public.mms_get(p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
  s public.meeting_summaries;
begin
  select * into m from public.meetings where id = p_meeting;
  select * into s from public.meeting_summaries where meeting_id = p_meeting;
  if m.id is null or not (private.mtg_can_view(m, me.id) or (s.id is not null and private.mms_can_see(me.id, s, m))) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  return private.mms_detail(m, me.id);
end $$;

-- the CEO's report view (Super Admin only): the same outcome fields, for any internal team meeting with a summary
create or replace function public.mms_report(p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
begin
  if me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the CEO (Super Admin) can open meeting reports here.' using errcode = '42501';
  end if;
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not private.mms_eligible(m) or not exists (select 1 from public.meeting_summaries s where s.meeting_id = m.id) then
    raise exception 'NOT_FOUND: Meeting report not found.' using errcode = 'P0002';
  end if;
  return private.mms_detail(m, me.id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Attendance, and who is responsible
-- ---------------------------------------------------------------------------
create or replace function public.mms_confirm_attendance(p_meeting uuid, p_attended uuid[], p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mms_meeting_for(p_meeting, me.id);
  s public.meeting_summaries;
  v_staff uuid[] := private.mtg_staff_ids(m);
  v_extra uuid[];
  o record;
  v_keep boolean;
begin
  if m.source_type is not null or not private.mtg_can_manage(m, me.id) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can confirm who attended.' using errcode = '42501';
  end if;
  if m.status not in ('SCHEDULED', 'COMPLETED') or m.starts_at > now() then
    raise exception 'CONFLICT: Attendance can be confirmed once the meeting has started.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(x), '{}') into v_extra from unnest(coalesce(p_attended, '{}')) x where not (x = any (v_staff));
  if cardinality(v_extra) > 0 then
    raise exception 'VALIDATION_ERROR: Only colleagues invited to this meeting can be marked as attended.' using errcode = 'P0001';
  end if;
  if cardinality(coalesce(p_attended, '{}')) = 0 then
    raise exception 'VALIDATION_ERROR: Mark at least one colleague who attended.' using errcode = 'P0001';
  end if;
  s := private.mms_ensure(m);
  if p_version is not null and s.version <> p_version then
    raise exception 'CONFLICT: This summary was changed by someone else. Reload it and try again.' using errcode = 'P0001';
  end if;
  if s.status in ('SUBMITTED', 'REVISION_REQUESTED', 'REVISED') then
    raise exception 'CONFLICT: The summary is already submitted; attendance can no longer be changed.' using errcode = 'P0001';
  end if;
  insert into public.meeting_summary_attendance (meeting_id, profile_id, attended, confirmed_by, confirmed_at)
  select m.id, x, x = any (p_attended), me.id, now() from unnest(v_staff) x
  on conflict (meeting_id, profile_id) do update set attended = excluded.attended, confirmed_by = excluded.confirmed_by, confirmed_at = now();
  -- an owner picked by hand stays while still attending and active; otherwise the rule decides again
  v_keep := s.owner_method in ('SELECTED', 'DELEGATED', 'TRANSFERRED', 'ROUTED', 'ESCALATED')
            and exists (select 1 from public.profiles p where p.id = s.owner_id and p.status = 'ACTIVE')
            and (s.owner_method in ('ROUTED', 'ESCALATED', 'TRANSFERRED') or s.owner_id = any (p_attended));
  if not v_keep then
    select * into o from private.mms_pick_owner(m);
    update public.meeting_summaries
       set owner_id = o.owner_id, owner_method = o.method, owner_reason = null, owner_assigned_by = null, owner_assigned_at = now(),
           selection_rank = o.rank, selection_candidates = o.candidates
     where id = s.id;
    if o.owner_id is not null then
      perform private.mms_set_scope(s.id, o.owner_id);
    end if;
  end if;
  update public.meeting_summaries set attendance_confirmed_at = now(), attendance_confirmed_by = me.id, version = version + 1, updated_at = now()
   where id = s.id returning * into s;
  perform private.mms_event(s.id, 'ATTENDANCE_CONFIRMED', null, jsonb_build_object('attended', to_jsonb(p_attended), 'invited', to_jsonb(v_staff),
    'owner', s.owner_id, 'method', s.owner_method));
  perform private.mtg_event(m.id, 'ATTENDANCE_CONFIRMED', null, jsonb_build_object('attended', cardinality(p_attended), 'invited', cardinality(v_staff)));
  perform private.write_audit('MEETING_ATTENDANCE_CONFIRMED', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('attended', to_jsonb(p_attended), 'owner', s.owner_id, 'method', s.owner_method));
  perform private.mms_notify_owner(s, m);
  return private.mms_detail(m, me.id);
end $$;

-- name the responsible leader by hand: choose among leaders of the same rank, the CEO delegating their own summary, or route / escalate
-- a meeting without a usable leader to one whose scope covers the attendees
create or replace function public.mms_assign_owner(p_meeting uuid, p_owner uuid, p_reason text default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mms_meeting_for(p_meeting, me.id);
  s public.meeting_summaries;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_manager boolean := m.source_type is null and private.mtg_can_manage(m, me.id);
  v_rank smallint := private.mms_rank(me.id);
  v_att uuid[] := private.mms_attending(m.id);
  v_owner_ok boolean;
  v_method text;
begin
  select * into s from public.meeting_summaries where meeting_id = m.id for update;
  if s.id is null or s.attendance_confirmed_at is null then
    raise exception 'CONFLICT: Confirm who attended first.' using errcode = 'P0001';
  end if;
  if p_version is not null and s.version <> p_version then
    raise exception 'CONFLICT: This summary was changed by someone else. Reload it and try again.' using errcode = 'P0001';
  end if;
  if s.status in ('SUBMITTED', 'REVISION_REQUESTED', 'REVISED') then
    raise exception 'CONFLICT: The summary is already submitted.' using errcode = 'P0001';
  end if;
  if not (v_manager or v_rank = 4 or (v_rank in (2, 3) and private.mms_supervises(me.id, s)) or s.owner_id is not distinct from me.id) then
    raise exception 'FORBIDDEN: Only the organiser, a supervisor of this team or the CEO can name who writes this summary.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_owner and p.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: Choose an active employee.' using errcode = 'P0001';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'VALIDATION_ERROR: Keep the reason under 500 characters.' using errcode = 'P0001';
  end if;
  v_owner_ok := s.owner_id is not null and exists (select 1 from public.profiles p where p.id = s.owner_id and p.status = 'ACTIVE')
                and (s.owner_id = any (v_att) or s.owner_method in ('ROUTED', 'ESCALATED', 'TRANSFERRED'));
  if s.owner_method = 'SELECTION_REQUIRED' and p_owner = any (s.selection_candidates) and (v_manager or v_rank >= 2) then
    v_method := 'SELECTED';
  elsif v_owner_ok and s.owner_id is not distinct from me.id and v_rank = 4 and p_owner = any (v_att) then
    -- the CEO hands their own summary to someone who attended
    v_method := 'DELEGATED';
  elsif not v_owner_ok and (private.mms_rank(p_owner) = 4
        or exists (select 1 from unnest(v_att) y where y <> p_owner and private.mms_covers(p_owner, y))) then
    v_method := case when s.owner_id is not null then 'TRANSFERRED' when v_manager and me.id is distinct from p_owner then 'ROUTED' else 'ESCALATED' end;
    if v_reason is null then
      raise exception 'VALIDATION_ERROR: Say why the summary is handed to this person.' using errcode = 'P0001';
    end if;
  else
    raise exception 'FORBIDDEN: This person cannot be made responsible for the summary (they must have attended, or lead the people who did).'
      using errcode = '42501';
  end if;
  update public.meeting_summaries
     set owner_id = p_owner, owner_method = v_method, owner_reason = v_reason, owner_assigned_by = me.id, owner_assigned_at = now(),
         version = version + 1, updated_at = now()
   where id = s.id returning * into s;
  perform private.mms_set_scope(s.id, p_owner);
  select * into s from public.meeting_summaries where id = s.id;
  perform private.mms_event(s.id, 'OWNER_' || v_method, v_reason, jsonb_build_object('owner', p_owner));
  perform private.write_audit('MEETING_SUMMARY_OWNER_SET', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('owner', p_owner, 'method', v_method, 'reason', v_reason));
  perform private.mms_notify_owner(s, m);
  return private.mms_detail(m, me.id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Writing: save a draft, submit, amend (one transaction; items are matched by their key, so a retry never duplicates them)
-- ---------------------------------------------------------------------------
create or replace function private.mms_text(p jsonb, p_key text, p_max integer, p_label text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p ->> p_key, '')), '');
begin
  if v is not null and length(v) > p_max then
    raise exception 'VALIDATION_ERROR: % is too long (at most % characters).', p_label, p_max using errcode = 'P0001';
  end if;
  return v;
end $$;
revoke all on function private.mms_text(jsonb, text, integer, text) from public, anon, authenticated;

create or replace function public.mms_save(p_meeting uuid, p jsonb, p_submit boolean default false, p_version integer default null,
  p_change_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mms_meeting_for(p_meeting, me.id);
  s public.meeting_summaries;
  v_manager boolean := m.source_type is null and private.mtg_can_manage(m, me.id);
  v_done boolean;
  v_writer uuid;
  v_att uuid[] := private.mms_attending(m.id);
  v_exec text := private.mms_text(p, 'executiveSummary', 8000, 'The executive summary');
  v_purpose text := private.mms_text(p, 'purposeNote', 1000, 'The purpose clarification');
  v_next text := private.mms_text(p, 'nextSteps', 4000, 'Next steps');
  v_fu_outcome text := private.mms_text(p -> 'followUp', 'outcome', 1000, 'The expected outcome');
  v_fu_required boolean := coalesce((p -> 'followUp' ->> 'required')::boolean, false);
  v_fu_date date := nullif(p -> 'followUp' ->> 'date', '')::date;
  v_no_dec boolean := coalesce((p ->> 'noDecisions')::boolean, false);
  v_no_block boolean := coalesce((p ->> 'noBlockers')::boolean, false);
  v_points jsonb := coalesce(p -> 'discussionPoints', '[]'::jsonb);
  v_dec jsonb := coalesce(p -> 'decisions', '[]'::jsonb);
  v_act jsonb := coalesce(p -> 'actions', '[]'::jsonb);
  v_blk jsonb := coalesce(p -> 'blockers', '[]'::jsonb);
  v_note text := nullif(btrim(coalesce(p_change_note, '')), '');
  x jsonb;
  i integer;
  v_kind text;
  v_new_assignees uuid[];
  r record;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'VALIDATION_ERROR: Send the summary.' using errcode = 'P0001';
  end if;
  if m.status not in ('SCHEDULED', 'COMPLETED') or m.starts_at > now() then
    raise exception 'CONFLICT: A summary can be written once the meeting has started.' using errcode = 'P0001';
  end if;
  s := private.mms_ensure(m);
  if p_version is null or s.version <> p_version then
    raise exception 'CONFLICT: This summary was changed by someone else. Reload it and try again.' using errcode = 'P0001';
  end if;
  v_done := s.status in ('SUBMITTED', 'REVISION_REQUESTED', 'REVISED');
  if p_submit then
    if s.owner_id is distinct from me.id then
      raise exception 'FORBIDDEN: Only the leader responsible for this summary can submit it.' using errcode = '42501';
    end if;
    if s.attendance_confirmed_at is null then
      raise exception 'CONFLICT: Confirm who attended first.' using errcode = 'P0001';
    end if;
  else
    if v_done then
      raise exception 'CONFLICT: This summary is already submitted. Submit an amendment instead.' using errcode = 'P0001';
    end if;
    if not (s.owner_id is not distinct from me.id or (s.owner_id is null and v_manager)) then
      raise exception 'FORBIDDEN: Only the leader responsible for this summary can change it.' using errcode = '42501';
    end if;
  end if;
  v_writer := coalesce(s.owner_id, me.id);

  -- the content
  if jsonb_typeof(v_points) <> 'array' or jsonb_typeof(v_dec) <> 'array' or jsonb_typeof(v_act) <> 'array' or jsonb_typeof(v_blk) <> 'array' then
    raise exception 'VALIDATION_ERROR: The summary is not in the expected shape.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_points) > 50 or jsonb_array_length(v_dec) > 50 or jsonb_array_length(v_act) > 100 or jsonb_array_length(v_blk) > 50 then
    raise exception 'VALIDATION_ERROR: Too many entries (at most 50 points, 50 decisions, 100 action items and 50 blockers).' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(btrim(e #>> '{}')), '[]'::jsonb) into v_points
    from jsonb_array_elements(v_points) e where nullif(btrim(coalesce(e #>> '{}', '')), '') is not null;
  if exists (select 1 from jsonb_array_elements_text(v_points) t where length(t) > 500) then
    raise exception 'VALIDATION_ERROR: Keep each discussion point under 500 characters.' using errcode = 'P0001';
  end if;
  if v_fu_required and v_fu_date is null and p_submit then
    raise exception 'VALIDATION_ERROR: Give the target date of the follow-up.' using errcode = 'P0001';
  end if;
  if p_submit then
    if v_exec is null or length(v_exec) < 20
       or (select count(distinct lower(w[1])) from regexp_matches(v_exec, '([[:alpha:]]{3,})', 'g') w) < 3 then
      raise exception 'VALIDATION_ERROR: Write the executive summary: what happened in the meeting (at least 20 characters).' using errcode = 'P0001';
    end if;
    if jsonb_array_length(v_dec) = 0 and not v_no_dec then
      raise exception 'VALIDATION_ERROR: Record the decisions taken, or tick "No decisions were made".' using errcode = 'P0001';
    end if;
    if jsonb_array_length(v_blk) = 0 and not v_no_block then
      raise exception 'VALIDATION_ERROR: Record the issues or blockers, or tick "No blockers".' using errcode = 'P0001';
    end if;
    if v_done and (v_note is null or length(v_note) < 3) then
      raise exception 'VALIDATION_ERROR: Say what changed in this amendment.' using errcode = 'P0001';
    end if;
  end if;
  if v_no_dec and jsonb_array_length(v_dec) > 0 then
    raise exception 'VALIDATION_ERROR: Remove the decisions or untick "No decisions were made".' using errcode = 'P0001';
  end if;
  if v_no_block and jsonb_array_length(v_blk) > 0 then
    raise exception 'VALIDATION_ERROR: Remove the blockers or untick "No blockers".' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the amendment note under 1000 characters.' using errcode = 'P0001';
  end if;

  -- items: every key once, valid people, departments and teams
  for x in select e from jsonb_array_elements(v_dec || v_act || v_blk) e loop
    if (x ->> 'key') is null or (x ->> 'key') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_ERROR: Every entry needs its key.' using errcode = 'P0001';
    end if;
  end loop;
  if (select count(*) <> count(distinct e ->> 'key') from jsonb_array_elements(v_dec || v_act || v_blk) e) then
    raise exception 'VALIDATION_ERROR: An entry is listed twice.' using errcode = 'P0001';
  end if;
  for x in select e from jsonb_array_elements(v_dec) e loop
    if length(btrim(coalesce(x ->> 'title', ''))) not between 2 and 200 or length(coalesce(x ->> 'description', '')) > 2000 then
      raise exception 'VALIDATION_ERROR: Give each decision a title (2 to 200 characters).' using errcode = 'P0001';
    end if;
    if coalesce(x ->> 'status', 'APPROVED') not in ('PROPOSED', 'APPROVED', 'IN_PROGRESS', 'IMPLEMENTED', 'ON_HOLD') then
      raise exception 'VALIDATION_ERROR: Unknown decision status.' using errcode = 'P0001';
    end if;
    if nullif(x ->> 'departmentId', '') is not null and not exists (select 1 from public.departments d where d.id = (x ->> 'departmentId')::uuid) then
      raise exception 'VALIDATION_ERROR: Choose a department from the list.' using errcode = 'P0001';
    end if;
    if nullif(x ->> 'teamId', '') is not null and not exists (select 1 from public.teams t where t.id = (x ->> 'teamId')::uuid
         and (nullif(x ->> 'departmentId', '') is null or t.department_id = (x ->> 'departmentId')::uuid)) then
      raise exception 'VALIDATION_ERROR: Choose a team of that department.' using errcode = 'P0001';
    end if;
    if nullif(x ->> 'decidedBy', '') is not null and not ((x ->> 'decidedBy')::uuid = any (v_att) or (x ->> 'decidedBy')::uuid = v_writer
         or private.mms_rank((x ->> 'decidedBy')::uuid) = 4) then
      raise exception 'VALIDATION_ERROR: The decision maker must be someone who attended (or the CEO).' using errcode = 'P0001';
    end if;
  end loop;
  for x in select e from jsonb_array_elements(v_act) e loop
    if length(btrim(coalesce(x ->> 'title', ''))) not between 2 and 200 or length(coalesce(x ->> 'description', '')) > 2000 then
      raise exception 'VALIDATION_ERROR: Give each action item a title (2 to 200 characters).' using errcode = 'P0001';
    end if;
    if nullif(x ->> 'assigneeId', '') is null or not private.mms_can_assign(v_writer, (x ->> 'assigneeId')::uuid) then
      raise exception 'FORBIDDEN: An action item can be given only to someone you lead (or to yourself).' using errcode = '42501';
    end if;
    if coalesce(x ->> 'priority', 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')
       or coalesce(x ->> 'status', 'PENDING') not in ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED') then
      raise exception 'VALIDATION_ERROR: Unknown priority or status of an action item.' using errcode = 'P0001';
    end if;
    if nullif(x ->> 'decisionKey', '') is not null and not exists (select 1 from jsonb_array_elements(v_dec) d where d ->> 'key' = x ->> 'decisionKey') then
      raise exception 'VALIDATION_ERROR: An action item is linked to a decision that is not in this summary.' using errcode = 'P0001';
    end if;
  end loop;
  for x in select e from jsonb_array_elements(v_blk) e loop
    if length(btrim(coalesce(x ->> 'description', ''))) not between 2 and 2000 then
      raise exception 'VALIDATION_ERROR: Describe each blocker (2 to 2000 characters).' using errcode = 'P0001';
    end if;
    if coalesce(x ->> 'category', 'OTHER') not in ('PENDING_APPROVAL', 'RESOURCE', 'OPERATIONAL', 'CUSTOMER_ESCALATION', 'DEPENDENCY', 'CEO_DECISION', 'OTHER') then
      raise exception 'VALIDATION_ERROR: Unknown blocker type.' using errcode = 'P0001';
    end if;
  end loop;

  -- new assignees (to tell them once the summary is submitted)
  select coalesce(array_agg(distinct (e ->> 'assigneeId')::uuid), '{}') into v_new_assignees
    from jsonb_array_elements(v_act) e
   where not exists (select 1 from public.meeting_summary_actions a where a.summary_id = s.id and a.client_key = (e ->> 'key')::uuid
                       and a.assignee_id = (e ->> 'assigneeId')::uuid and s.revision_no > 0);

  -- write the items: keep the ones still listed (by key), drop the rest
  delete from public.meeting_summary_decisions d where d.summary_id = s.id
     and not exists (select 1 from jsonb_array_elements(v_dec) e where (e ->> 'key')::uuid = d.client_key);
  delete from public.meeting_summary_actions a where a.summary_id = s.id
     and not exists (select 1 from jsonb_array_elements(v_act) e where (e ->> 'key')::uuid = a.client_key);
  delete from public.meeting_summary_blockers b where b.summary_id = s.id
     and not exists (select 1 from jsonb_array_elements(v_blk) e where (e ->> 'key')::uuid = b.client_key);
  i := 0;
  for x in select e from jsonb_array_elements(v_dec) e loop
    i := i + 1;
    insert into public.meeting_summary_decisions as d (summary_id, client_key, position, title, description, department_id, team_id, decided_by, status)
    values (s.id, (x ->> 'key')::uuid, i, btrim(x ->> 'title'), nullif(btrim(coalesce(x ->> 'description', '')), ''),
            nullif(x ->> 'departmentId', '')::uuid, nullif(x ->> 'teamId', '')::uuid, coalesce(nullif(x ->> 'decidedBy', '')::uuid, v_writer),
            coalesce(x ->> 'status', 'APPROVED'))
    on conflict (summary_id, client_key) do update
      set position = excluded.position, title = excluded.title, description = excluded.description, department_id = excluded.department_id,
          team_id = excluded.team_id, decided_by = excluded.decided_by, status = excluded.status, updated_at = now();
  end loop;
  i := 0;
  for x in select e from jsonb_array_elements(v_act) e loop
    i := i + 1;
    insert into public.meeting_summary_actions as a (summary_id, client_key, position, title, description, assignee_id, due_date, priority, status,
      decision_key, completed_at, updated_by)
    values (s.id, (x ->> 'key')::uuid, i, btrim(x ->> 'title'), nullif(btrim(coalesce(x ->> 'description', '')), ''),
            (x ->> 'assigneeId')::uuid, nullif(x ->> 'dueDate', '')::date, coalesce(x ->> 'priority', 'MEDIUM'), coalesce(x ->> 'status', 'PENDING'),
            nullif(x ->> 'decisionKey', '')::uuid, case when x ->> 'status' = 'DONE' then now() end, me.id)
    on conflict (summary_id, client_key) do update
      set position = excluded.position, title = excluded.title, description = excluded.description, assignee_id = excluded.assignee_id,
          due_date = excluded.due_date, priority = excluded.priority, status = excluded.status, decision_key = excluded.decision_key,
          completed_at = case when excluded.status = 'DONE' then coalesce(a.completed_at, now()) end,
          updated_by = me.id, updated_at = now();
  end loop;
  i := 0;
  for x in select e from jsonb_array_elements(v_blk) e loop
    i := i + 1;
    insert into public.meeting_summary_blockers as b (summary_id, client_key, position, category, description, needs_ceo_attention)
    values (s.id, (x ->> 'key')::uuid, i, coalesce(x ->> 'category', 'OTHER'), btrim(x ->> 'description'),
            coalesce((x ->> 'needsCeoAttention')::boolean, false))
    on conflict (summary_id, client_key) do update
      set position = excluded.position, category = excluded.category, description = excluded.description,
          needs_ceo_attention = excluded.needs_ceo_attention, updated_at = now();
  end loop;

  v_kind := case when not p_submit then 'DRAFT' when v_done then 'REVISED' else 'SUBMITTED' end;
  update public.meeting_summaries
     set purpose_note = v_purpose, executive_summary = v_exec, discussion_points = v_points, no_decisions = v_no_dec, no_blockers = v_no_block,
         next_steps = v_next, follow_up_required = v_fu_required, follow_up_date = case when v_fu_required then v_fu_date end,
         follow_up_outcome = case when v_fu_required then v_fu_outcome end,
         status = v_kind,
         drafted_by = case when p_submit then drafted_by else me.id end,
         submitted_by = case when p_submit then me.id else submitted_by end,
         submitted_at = case when p_submit then now() else submitted_at end,
         first_submitted_at = case when p_submit then coalesce(first_submitted_at, now()) else first_submitted_at end,
         revision_no = case when p_submit then revision_no + 1 else revision_no end,
         version = version + 1, updated_at = now()
   where id = s.id returning * into s;

  if not p_submit then
    perform private.mms_event(s.id, 'DRAFT_SAVED');
    return private.mms_detail(m, me.id);
  end if;

  insert into public.meeting_summary_revisions (summary_id, revision_no, kind, change_note, snapshot, actor_id)
  values (s.id, s.revision_no, v_kind, v_note, private.mms_content(s) || jsonb_build_object(
            'submittedBy', me.full_name, 'submittedAt', s.submitted_at,
            'attended', (select coalesce(jsonb_agg(p2.full_name order by p2.full_name), '[]'::jsonb) from public.profiles p2 where p2.id = any (v_att))),
          me.id);
  -- the meeting is complete with its summary (same effect as mtg_complete)
  if m.status = 'SCHEDULED' then
    update public.meetings set status = 'COMPLETED', google_sync_status = 'SKIPPED' where id = m.id returning * into m;
    perform private.mtg_event(m.id, 'COMPLETED', 'Completed with its summary.');
  end if;
  perform private.mms_event(s.id, v_kind, v_note, jsonb_build_object('revision', s.revision_no));
  perform private.write_audit('MEETING_SUMMARY_' || v_kind, 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('revision', s.revision_no, 'decisions', jsonb_array_length(v_dec), 'actions', jsonb_array_length(v_act),
      'blockers', jsonb_array_length(v_blk), 'note', v_note));
  -- the CEO: a new report, or one that changed
  for r in select p2.id from public.profiles p2 where p2.role = 'SUPER_ADMIN' and p2.status = 'ACTIVE' loop
    perform private.notify_once(r.id, 'MEETING_SUMMARY_' || v_kind,
      case when v_kind = 'REVISED' then 'Meeting report revised: ' else 'Meeting report: ' end || m.title,
      coalesce(me.full_name, 'A leader') || case when v_kind = 'REVISED' then ' amended the report (revision ' || s.revision_no || ')'
        || coalesce(': ' || v_note, '') || '.' else ' submitted the summary: ' || jsonb_array_length(v_dec) || ' decision(s), '
        || jsonb_array_length(v_act) || ' action item(s), ' || jsonb_array_length(v_blk) || ' blocker(s).' end,
      'meeting_summary', m.id, jsonb_build_object('meetingId', m.id, 'revision', s.revision_no), 'normal');
  end loop;
  -- the people given work
  for r in select distinct a.assignee_id, a.title from public.meeting_summary_actions a
            where a.summary_id = s.id and a.assignee_id = any (v_new_assignees) and a.status not in ('DONE', 'CANCELLED') loop
    perform private.notify_once(r.assignee_id, 'MEETING_ACTION_ASSIGNED', 'Action item from ' || m.title,
      r.title, 'meeting_summary', m.id, jsonb_build_object('meetingId', m.id), 'normal');
  end loop;
  return private.mms_detail(m, me.id);
end $$;

-- ---------------------------------------------------------------------------
-- 7. The CEO's questions and follow-ups, the leader's answers, progress on action items
-- ---------------------------------------------------------------------------
create or replace function public.mms_clarify(p_meeting uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
  s public.meeting_summaries;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the CEO (Super Admin) can ask for a clarification.' using errcode = '42501';
  end if;
  if v_msg is null or length(v_msg) < 5 or length(v_msg) > 2000 then
    raise exception 'VALIDATION_ERROR: Write the question (5 to 2000 characters).' using errcode = 'P0001';
  end if;
  select * into m from public.meetings where id = p_meeting;
  select * into s from public.meeting_summaries where meeting_id = p_meeting for update;
  if m.id is null or s.id is null or not private.mms_eligible(m) then
    raise exception 'NOT_FOUND: Meeting report not found.' using errcode = 'P0002';
  end if;
  if s.status not in ('SUBMITTED', 'REVISED') then
    raise exception 'CONFLICT: Only a submitted report can be sent back with a question.' using errcode = 'P0001';
  end if;
  insert into public.meeting_summary_comments (summary_id, author_id, kind, body) values (s.id, me.id, 'CLARIFICATION', v_msg);
  update public.meeting_summaries set status = 'REVISION_REQUESTED', version = version + 1, updated_at = now() where id = s.id returning * into s;
  perform private.mms_event(s.id, 'CLARIFICATION_REQUESTED', v_msg);
  perform private.write_audit('MEETING_SUMMARY_CLARIFICATION', 'meeting', m.id, me.department_id, me.team_id, jsonb_build_object('message', v_msg));
  perform private.notify(coalesce((select p.id from public.profiles p where p.id = s.owner_id and p.status = 'ACTIVE'), s.submitted_by),
    'MEETING_SUMMARY_CLARIFICATION', 'The CEO asked about: ' || m.title, v_msg, 'meeting', m.id,
    jsonb_build_object('meetingId', m.id, 'summary', true), 'urgent');
  return private.mms_detail(m, me.id);
end $$;

create or replace function public.mms_reply(p_meeting uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
  s public.meeting_summaries;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  r record;
begin
  select * into m from public.meetings where id = p_meeting;
  select * into s from public.meeting_summaries where meeting_id = p_meeting;
  if m.id is null or s.id is null or not private.mms_can_see(me.id, s, m) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if s.revision_no = 0 or not (s.owner_id is not distinct from me.id or s.submitted_by is not distinct from me.id) then
    raise exception 'FORBIDDEN: Only the leader who wrote this summary can answer on it.' using errcode = '42501';
  end if;
  if v_msg is null or length(v_msg) < 2 or length(v_msg) > 2000 then
    raise exception 'VALIDATION_ERROR: Write the answer (2 to 2000 characters).' using errcode = 'P0001';
  end if;
  insert into public.meeting_summary_comments (summary_id, author_id, kind, body) values (s.id, me.id, 'RESPONSE', v_msg);
  perform private.mms_event(s.id, 'RESPONSE', v_msg);
  for r in select p2.id from public.profiles p2 where p2.role = 'SUPER_ADMIN' and p2.status = 'ACTIVE' loop
    perform private.notify(r.id, 'MEETING_SUMMARY_RESPONSE', 'Answer on: ' || m.title, v_msg, 'meeting_summary', m.id,
      jsonb_build_object('meetingId', m.id), 'normal');
  end loop;
  return private.mms_detail(m, me.id);
end $$;

-- the CEO marks a decision or a blocker for follow-up (or clears the mark); the report itself is not changed
create or replace function public.mms_flag(p_meeting uuid, p_item_type text, p_item uuid, p_flag boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings;
  s public.meeting_summaries;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_title text;
begin
  if me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the CEO (Super Admin) can mark items for follow-up.' using errcode = '42501';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 1000 characters.' using errcode = 'P0001';
  end if;
  select * into m from public.meetings where id = p_meeting;
  select * into s from public.meeting_summaries where meeting_id = p_meeting;
  if m.id is null or s.id is null or s.revision_no = 0 then
    raise exception 'NOT_FOUND: Meeting report not found.' using errcode = 'P0002';
  end if;
  if p_item_type = 'DECISION' then
    update public.meeting_summary_decisions set ceo_follow_up = coalesce(p_flag, false), ceo_follow_up_note = v_note,
           ceo_follow_up_at = case when p_flag then now() end
     where id = p_item and summary_id = s.id returning title into v_title;
  elsif p_item_type = 'BLOCKER' then
    update public.meeting_summary_blockers set ceo_follow_up = coalesce(p_flag, false), ceo_follow_up_note = v_note,
           ceo_follow_up_at = case when p_flag then now() end
     where id = p_item and summary_id = s.id returning left(description, 120) into v_title;
  else
    raise exception 'VALIDATION_ERROR: Mark a DECISION or a BLOCKER.' using errcode = 'P0001';
  end if;
  if v_title is null then
    raise exception 'NOT_FOUND: That item is not in this report.' using errcode = 'P0002';
  end if;
  if p_flag then
    insert into public.meeting_summary_comments (summary_id, author_id, kind, body)
    values (s.id, me.id, 'FOLLOW_UP', 'Follow-up on "' || v_title || '"' || coalesce(': ' || v_note, '.'));
    perform private.notify(coalesce((select p.id from public.profiles p where p.id = s.owner_id and p.status = 'ACTIVE'), s.submitted_by),
      'MEETING_SUMMARY_FOLLOW_UP', 'The CEO is following up: ' || m.title, v_title || coalesce(' - ' || v_note, ''), 'meeting', m.id,
      jsonb_build_object('meetingId', m.id, 'summary', true), 'normal');
  end if;
  perform private.mms_event(s.id, case when p_flag then 'FOLLOW_UP_MARKED' else 'FOLLOW_UP_CLEARED' end, v_note,
    jsonb_build_object('type', p_item_type, 'item', p_item));
  perform private.write_audit('MEETING_SUMMARY_FOLLOW_UP', 'meeting', m.id, me.department_id, me.team_id,
    jsonb_build_object('type', p_item_type, 'item', p_item, 'flag', p_flag, 'note', v_note));
  return private.mms_detail(m, me.id);
end $$;

-- progress on an action item: its assignee or the summary's owner (the change is kept in the history)
create or replace function public.mms_action_update(p_action uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  a public.meeting_summary_actions;
  s public.meeting_summaries;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into a from public.meeting_summary_actions where id = p_action for update;
  select * into s from public.meeting_summaries where id = a.summary_id;
  if a.id is null or s.revision_no = 0 or not (a.assignee_id = me.id or s.owner_id is not distinct from me.id) then
    raise exception 'NOT_FOUND: Action item not found.' using errcode = 'P0002';
  end if;
  if p_status not in ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  if p_status = 'CANCELLED' and s.owner_id is distinct from me.id then
    raise exception 'FORBIDDEN: Only the leader who gave the action item can cancel it.' using errcode = '42501';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 1000 characters.' using errcode = 'P0001';
  end if;
  update public.meeting_summary_actions
     set status = p_status, completed_at = case when p_status = 'DONE' then coalesce(completed_at, now()) end, updated_by = me.id, updated_at = now()
   where id = a.id;
  perform private.mms_event(s.id, 'ACTION_UPDATED', v_note, jsonb_build_object('action', a.id, 'title', a.title, 'from', a.status, 'to', p_status));
  perform private.write_audit('MEETING_ACTION_UPDATED', 'meeting', s.meeting_id, me.department_id, me.team_id,
    jsonb_build_object('action', a.id, 'from', a.status, 'to', p_status));
  return jsonb_build_object('id', a.id, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Lists: the leader's own summaries, a supervisor's team, the CEO's reports
-- ---------------------------------------------------------------------------
-- one row of a list (counts only; the content opens with mms_get / mms_report)
create or replace function private.mms_row(s public.meeting_summaries, m public.meetings)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'meetingId', m.id, 'reference', m.reference, 'title', m.title, 'startsAt', m.starts_at, 'endsAt', m.ends_at, 'timezone', m.timezone,
    'meetingStatus', m.status,
    'department', (select d.name from public.departments d where d.id = s.scope_department_id), 'departmentId', s.scope_department_id,
    'team', (select t.name from public.teams t where t.id = s.scope_team_id), 'teamId', s.scope_team_id,
    'owner', private.mms_person(s.owner_id), 'ownerMethod', s.owner_method, 'hostName', (select p.full_name from public.profiles p where p.id = m.host_id),
    'attendees', (select count(*) from public.meeting_summary_attendance a where a.meeting_id = m.id and a.attended),
    'invited', cardinality(private.mtg_staff_ids(m)),
    'status', s.status, 'overdue', private.mms_overdue(s, m), 'dueAt', private.mms_due_at(m), 'isHistorical', s.is_historical,
    'awaitingAttendance', s.attendance_confirmed_at is null,
    'decisions', (select count(*) from public.meeting_summary_decisions d where d.summary_id = s.id and s.revision_no > 0),
    'actions', (select count(*) from public.meeting_summary_actions a where a.summary_id = s.id and s.revision_no > 0),
    'openActions', (select count(*) from public.meeting_summary_actions a where a.summary_id = s.id and s.revision_no > 0
                      and a.status in ('PENDING', 'IN_PROGRESS', 'BLOCKED')),
    'blockers', (select count(*) from public.meeting_summary_blockers b where b.summary_id = s.id and s.revision_no > 0),
    'needsAttention', s.revision_no > 0 and (
        exists (select 1 from public.meeting_summary_blockers b where b.summary_id = s.id and (b.needs_ceo_attention or b.ceo_follow_up))
        or exists (select 1 from public.meeting_summary_decisions d where d.summary_id = s.id and d.ceo_follow_up)),
    'submittedAt', s.submitted_at, 'revisionNo', s.revision_no, 'version', s.version)
$$;
revoke all on function private.mms_row(public.meeting_summaries, public.meetings) from public, anon, authenticated;

create or replace function private.mms_tab_of(s public.meeting_summaries, m public.meetings)
returns text language sql stable security definer set search_path = '' as $$
  select case when private.mms_overdue(s, m) then 'OVERDUE'
              when s.status in ('SUBMITTED', 'REVISED') then 'SUBMITTED'
              when s.status = 'DRAFT' then 'DRAFT'
              else 'PENDING' end
$$;
revoke all on function private.mms_tab_of(public.meeting_summaries, public.meetings) from public, anon, authenticated;

-- p_scope MINE: summaries I must write (or confirm attendance for as the organiser) and those I wrote.
-- p_scope TEAM: the summaries of the units I supervise (Operations Head, Department Head, Team Lead; the Super Admin: everything).
create or replace function public.mms_list(p_scope text default 'MINE', p_tab text default 'PENDING', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  v_items jsonb;
  v_counts jsonb;
  v_total bigint;
begin
  if p_scope not in ('MINE', 'TEAM') or p_tab not in ('PENDING', 'DRAFT', 'SUBMITTED', 'OVERDUE', 'ALL') then
    raise exception 'VALIDATION_ERROR: Unknown list.' using errcode = 'P0001';
  end if;
  if p_scope = 'TEAM' and private.mms_rank(me.id) = 0 then
    raise exception 'FORBIDDEN: Only leaders see their teams'' meeting summaries.' using errcode = '42501';
  end if;
  with base as (
    select s, m, private.mms_tab_of(s, m) as tab
      from public.meeting_summaries s join public.meetings m on m.id = s.meeting_id
     where private.mms_eligible(m) and m.status in ('SCHEDULED', 'COMPLETED')
       and (m.ends_at <= now() or s.status <> 'PENDING')
       and (not s.is_historical or s.attendance_confirmed_at is not null)
       and case when p_scope = 'MINE'
                then s.owner_id is not distinct from me.id or s.submitted_by is not distinct from me.id
                     or (s.owner_id is null and m.source_type is null and private.mtg_can_manage(m, me.id))
                     or (s.attendance_confirmed_at is null and m.source_type is null and private.mtg_can_manage(m, me.id))
                else s.owner_id is distinct from me.id and private.mms_supervises(me.id, s) end)
  select (select coalesce(jsonb_agg(private.mms_row((b).s, (b).m) order by (b).m.starts_at desc), '[]'::jsonb)
            from (select * from base x where p_tab = 'ALL' or x.tab = p_tab order by (x.m).starts_at desc
                  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) b),
         (select count(*) from base x where p_tab = 'ALL' or x.tab = p_tab),
         (select jsonb_build_object('PENDING', count(*) filter (where tab = 'PENDING'), 'DRAFT', count(*) filter (where tab = 'DRAFT'),
                   'SUBMITTED', count(*) filter (where tab = 'SUBMITTED'), 'OVERDUE', count(*) filter (where tab = 'OVERDUE')) from base)
    into v_items, v_total, v_counts;
  return jsonb_build_object('items', v_items, 'total', v_total, 'counts', v_counts);
end $$;

-- action items given to me (from submitted summaries), to report progress
create or replace function public.mms_my_actions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'description', a.description, 'dueDate', a.due_date,
      'priority', a.priority, 'status', a.status,
      'overdue', a.status in ('PENDING', 'IN_PROGRESS', 'BLOCKED') and a.due_date < (now() at time zone 'Asia/Kolkata')::date,
      'meetingId', m.id, 'meetingTitle', m.title, 'meetingStartsAt', m.starts_at,
      'ownerName', (select p.full_name from public.profiles p where p.id = s.owner_id))
      order by (a.status in ('DONE', 'CANCELLED')), a.due_date nulls last, a.created_at)
    from public.meeting_summary_actions a join public.meeting_summaries s on s.id = a.summary_id join public.meetings m on m.id = s.meeting_id
   where a.assignee_id = me.id and s.revision_no > 0 and (a.status not in ('DONE', 'CANCELLED') or a.updated_at > now() - interval '30 days')), '[]'::jsonb);
end $$;

create or replace function private.mms_require_ceo()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
begin
  if me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Meeting Decisions is for the CEO (Super Admin) only.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.mms_require_ceo() from public, anon, authenticated;

-- the reports of a period (meeting date, India), filtered on the server
create or replace function private.mms_report_rows(p jsonb)
returns table (s public.meeting_summaries, m public.meetings, tab text)
language sql stable security definer set search_path = '' as $$
  select s, m, private.mms_tab_of(s, m)
    from public.meeting_summaries s join public.meetings m on m.id = s.meeting_id
   where private.mms_eligible(m) and m.status in ('SCHEDULED', 'COMPLETED') and m.starts_at <= now()
     and (not s.is_historical or s.revision_no > 0)
     and (m.starts_at at time zone 'Asia/Kolkata')::date between coalesce(nullif(p ->> 'from', '')::date, '2000-01-01')
                                                             and coalesce(nullif(p ->> 'to', '')::date, '2999-12-31')
     and (nullif(p ->> 'departmentId', '') is null or s.scope_department_id = (p ->> 'departmentId')::uuid)
     and (nullif(p ->> 'teamId', '') is null or s.scope_team_id = (p ->> 'teamId')::uuid)
     and (nullif(p ->> 'leaderId', '') is null or s.owner_id = (p ->> 'leaderId')::uuid)
     and (nullif(p ->> 'leaderRank', '') is null or private.mms_rank(s.owner_id) = (p ->> 'leaderRank')::integer)
$$;
revoke all on function private.mms_report_rows(jsonb) from public, anon, authenticated;

create or replace function public.mms_reports_overview(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mms_require_ceo();
  v jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  with r as (select * from private.mms_report_rows(coalesce(p, '{}'::jsonb))),
       sub as (select (r.s).id as sid, r.m from r where (r.s).revision_no > 0),
       acts as (select a.* from public.meeting_summary_actions a join sub on sub.sid = a.summary_id)
  select jsonb_build_object(
    'held', (select count(*) from r),
    'submitted', (select count(*) from r where (r.s).status in ('SUBMITTED', 'REVISED')),
    'revisionRequested', (select count(*) from r where (r.s).status = 'REVISION_REQUESTED'),
    'pending', (select count(*) from r where r.tab in ('PENDING', 'DRAFT') and (r.s).status in ('PENDING', 'DRAFT')),
    'overdue', (select count(*) from r where r.tab = 'OVERDUE'),
    'decisions', (select count(*) from public.meeting_summary_decisions d join sub on sub.sid = d.summary_id),
    'openActions', (select count(*) from acts where acts.status in ('PENDING', 'IN_PROGRESS', 'BLOCKED')),
    'overdueActions', (select count(*) from acts where acts.status in ('PENDING', 'IN_PROGRESS', 'BLOCKED') and acts.due_date < v_today),
    'attention', (select count(*) from public.meeting_summary_blockers b join sub on sub.sid = b.summary_id where b.needs_ceo_attention or b.ceo_follow_up)
               + (select count(*) from public.meeting_summary_decisions d join sub on sub.sid = d.summary_id where d.ceo_follow_up),
    'latestDecisions', coalesce((select jsonb_agg(x.j order by x.at desc) from (
        select jsonb_build_object('id', d.id, 'title', d.title, 'description', d.description, 'status', d.status, 'ceoFollowUp', d.ceo_follow_up,
          'decidedByName', (select p2.full_name from public.profiles p2 where p2.id = d.decided_by),
          'department', coalesce((select dp.name from public.departments dp where dp.id = d.department_id),
                                 (select dp.name from public.departments dp join public.meeting_summaries s2 on s2.scope_department_id = dp.id where s2.id = d.summary_id)),
          'meetingId', (sub.m).id, 'meetingTitle', (sub.m).title, 'meetingStartsAt', (sub.m).starts_at) as j, (sub.m).starts_at as at
          from public.meeting_summary_decisions d join sub on sub.sid = d.summary_id order by (sub.m).starts_at desc, d.position limit 10) x), '[]'::jsonb),
    'attentionItems', coalesce((select jsonb_agg(x.j order by x.at desc) from (
        select jsonb_build_object('type', 'BLOCKER', 'id', b.id, 'text', b.description, 'category', b.category, 'flagged', b.ceo_follow_up,
          'meetingId', (sub.m).id, 'meetingTitle', (sub.m).title) as j, (sub.m).starts_at as at
          from public.meeting_summary_blockers b join sub on sub.sid = b.summary_id where b.needs_ceo_attention or b.ceo_follow_up
        union all
        select jsonb_build_object('type', 'DECISION', 'id', d.id, 'text', d.title, 'category', null, 'flagged', true,
          'meetingId', (sub.m).id, 'meetingTitle', (sub.m).title), (sub.m).starts_at
          from public.meeting_summary_decisions d join sub on sub.sid = d.summary_id where d.ceo_follow_up
        order by 2 desc limit 20) x), '[]'::jsonb),
    -- the choices of the filters
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d
        where d.facet_of is null and exists (select 1 from public.meeting_summaries s where s.scope_department_id = d.id)), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'departmentId', t.department_id) order by t.name) from public.teams t
        where exists (select 1 from public.meeting_summaries s where s.scope_team_id = t.id)), '[]'::jsonb),
    'leaders', coalesce((select jsonb_agg(private.mms_person(o.id) order by o.full_name) from public.profiles o
        where exists (select 1 from public.meeting_summaries s where s.owner_id = o.id)), '[]'::jsonb),
    'overdueHours', (select x.overdue_hours from public.meeting_summary_settings x where x.id))
    into v;
  return v;
end $$;

create or replace function public.mms_reports(p jsonb default '{}'::jsonb, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mms_require_ceo();
  v_status text := nullif(coalesce(p, '{}'::jsonb) ->> 'status', '');
  v_att boolean := coalesce((p ->> 'attention')::boolean, false);
  v_items jsonb;
  v_total bigint;
begin
  if v_status is not null and v_status not in ('SUBMITTED', 'PENDING', 'OVERDUE', 'REVISION_REQUESTED', 'DRAFT') then
    raise exception 'VALIDATION_ERROR: Unknown status filter.' using errcode = 'P0001';
  end if;
  with r as (
    select x.s, x.m, private.mms_row(x.s, x.m) as j from private.mms_report_rows(coalesce(p, '{}'::jsonb)) x
     where (v_status is null
            or (v_status = 'SUBMITTED' and (x.s).status in ('SUBMITTED', 'REVISED'))
            or (v_status = 'REVISION_REQUESTED' and (x.s).status = 'REVISION_REQUESTED')
            or (v_status = 'DRAFT' and x.tab = 'DRAFT')
            or (v_status = 'PENDING' and x.tab = 'PENDING' and (x.s).status = 'PENDING')
            or (v_status = 'OVERDUE' and x.tab = 'OVERDUE')))
  select (select coalesce(jsonb_agg(y.j order by (y.m).starts_at desc), '[]'::jsonb)
            from (select * from r where not v_att or (r.j ->> 'needsAttention')::boolean order by (r.m).starts_at desc
                  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) y),
         (select count(*) from r where not v_att or (r.j ->> 'needsAttention')::boolean)
    into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total);
end $$;

-- every action item of the submitted reports, to follow them up (Super Admin)
create or replace function public.mms_report_actions(p jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.mms_require_ceo();
  v_status text := coalesce(nullif(p ->> 'status', ''), 'OPEN');
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_items jsonb;
  v_total bigint;
begin
  if v_status not in ('OPEN', 'OVERDUE', 'DONE', 'ALL') then
    raise exception 'VALIDATION_ERROR: Unknown status filter.' using errcode = 'P0001';
  end if;
  with a as (
    select x.*, r.m, r.s from private.mms_report_rows(coalesce(p, '{}'::jsonb)) r join public.meeting_summary_actions x on x.summary_id = (r.s).id
     where (r.s).revision_no > 0
       and case v_status when 'OPEN' then x.status in ('PENDING', 'IN_PROGRESS', 'BLOCKED')
                         when 'OVERDUE' then x.status in ('PENDING', 'IN_PROGRESS', 'BLOCKED') and x.due_date < v_today
                         when 'DONE' then x.status = 'DONE' else true end
       and (nullif(p ->> 'assigneeId', '') is null or x.assignee_id = (p ->> 'assigneeId')::uuid))
  select (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'title', y.title, 'description', y.description, 'status', y.status,
            'priority', y.priority, 'dueDate', y.due_date, 'overdue', y.status in ('PENDING', 'IN_PROGRESS', 'BLOCKED') and y.due_date < v_today,
            'assigneeName', (select p2.full_name from public.profiles p2 where p2.id = y.assignee_id),
            'decision', (select d.title from public.meeting_summary_decisions d where d.summary_id = y.summary_id and d.client_key = y.decision_key),
            'meetingId', (y.m).id, 'meetingTitle', (y.m).title, 'meetingStartsAt', (y.m).starts_at,
            'ownerName', (select p2.full_name from public.profiles p2 where p2.id = (y.s).owner_id),
            'department', (select d.name from public.departments d where d.id = (y.s).scope_department_id), 'updatedAt', y.updated_at)
            order by y.due_date nulls last, y.created_at), '[]'::jsonb)
            from (select * from a order by a.due_date nulls last, a.created_at
                  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) y),
         (select count(*) from a)
    into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- 9. The scheduled check (server only): meeting ended -> organiser confirms attendance; overdue -> the responsible leader is told once
-- ---------------------------------------------------------------------------
create or replace function public.mms_sweep()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_pending integer := 0;
  v_overdue integer := 0;
  v_owner integer := 0;
  x uuid;
begin
  for r in select s, m from public.meeting_summaries s join public.meetings m on m.id = s.meeting_id
            where private.mms_eligible(m) and m.status in ('SCHEDULED', 'COMPLETED') and m.ends_at <= now() and not s.is_historical
              and s.status in ('PENDING', 'DRAFT')
            order by m.ends_at limit 500 loop
    -- the meeting ended: the organiser confirms who attended (once)
    if (r.s).attendance_confirmed_at is null and (r.s).pending_notified_at is null then
      foreach x in array array[(r.m).host_id, (r.m).created_by] loop
        if x is not null and exists (select 1 from public.profiles p where p.id = x and p.status = 'ACTIVE') then
          perform private.notify_once(x, 'MEETING_SUMMARY_ATTENDANCE', 'Meeting ended: ' || (r.m).title,
            'Confirm who attended so the responsible leader can submit the summary.', 'meeting', (r.m).id,
            jsonb_build_object('meetingId', (r.m).id, 'summary', true), 'normal');
        end if;
      end loop;
      update public.meeting_summaries set pending_notified_at = now() where id = (r.s).id;
      v_pending := v_pending + 1;
    end if;
    -- a leader named but not yet told
    if (r.s).owner_id is not null and (r.s).owner_notified_id is distinct from (r.s).owner_id then
      perform private.mms_notify_owner(r.s, r.m);
      v_owner := v_owner + 1;
    end if;
    -- overdue: the leader (or, without one, the organiser) is told once
    if private.mms_overdue(r.s, r.m) and (r.s).overdue_notified_at is null then
      foreach x in array case when (r.s).owner_id is not null then array[(r.s).owner_id] else array[(r.m).host_id, (r.m).created_by] end loop
        if x is not null then
          perform private.notify_once(x, 'MEETING_SUMMARY_OVERDUE', 'Summary overdue: ' || (r.m).title,
            'The summary of this meeting (' || private.mtg_when((r.m).starts_at, (r.m).timezone) || ') was due '
              || to_char(private.mms_due_at(r.m) at time zone coalesce(nullif((r.m).timezone, ''), 'Asia/Kolkata'), 'DD Mon HH24:MI') || '.',
            'meeting', (r.m).id, jsonb_build_object('meetingId', (r.m).id, 'summary', true), 'urgent');
        end if;
      end loop;
      update public.meeting_summaries set overdue_notified_at = now() where id = (r.s).id;
      perform private.mms_event((r.s).id, 'OVERDUE');
      v_overdue := v_overdue + 1;
    end if;
  end loop;
  return jsonb_build_object('attendanceRequests', v_pending, 'ownersTold', v_owner, 'overdue', v_overdue);
end $$;

-- ---------------------------------------------------------------------------
-- 10. mtg_complete: unchanged for every other meeting; a team meeting is completed by submitting its summary
-- ---------------------------------------------------------------------------
create or replace function public.mtg_complete(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.mtg_me();
  m public.meetings := private.mtg_for_update(p_id, null);
begin
  if not private.mtg_can_view(m, me.id) then
    raise exception 'NOT_FOUND: Meeting not found.' using errcode = 'P0002';
  end if;
  if m.source_type is not null or not private.mtg_can_manage(m, me.id) then
    raise exception 'FORBIDDEN: Only the host or the person who booked the meeting can mark it done.' using errcode = '42501';
  end if;
  if m.status <> 'SCHEDULED' or m.starts_at > now() then
    raise exception 'CONFLICT: Only a scheduled meeting that has started can be marked done.' using errcode = 'P0001';
  end if;
  if private.mms_eligible(m) and exists (select 1 from public.meeting_summaries s
                                          where s.meeting_id = m.id and not s.is_historical
                                            and s.status not in ('SUBMITTED', 'REVISION_REQUESTED', 'REVISED')) then
    raise exception 'CONFLICT: This team meeting is completed when its summary is submitted. Confirm who attended, then the responsible leader submits the summary.'
      using errcode = 'P0001';
  end if;
  update public.meetings set status = 'COMPLETED', google_sync_status = 'SKIPPED' where id = m.id returning * into m;
  perform private.mtg_event(m.id, 'COMPLETED', nullif(btrim(coalesce(p_note, '')), ''));
  return private.mtg_json(m, me.id);
end $$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public.mms_get(uuid)', 'public.mms_report(uuid)', 'public.mms_confirm_attendance(uuid, uuid[], integer)',
    'public.mms_assign_owner(uuid, uuid, text, integer)', 'public.mms_save(uuid, jsonb, boolean, integer, text)', 'public.mms_clarify(uuid, text)',
    'public.mms_reply(uuid, text)', 'public.mms_flag(uuid, text, uuid, boolean, text)', 'public.mms_action_update(uuid, text, text)',
    'public.mms_list(text, text, integer, integer)', 'public.mms_my_actions()', 'public.mms_reports_overview(jsonb)',
    'public.mms_reports(jsonb, integer, integer)', 'public.mms_report_actions(jsonb, integer, integer)', 'public.mtg_complete(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.mms_sweep() from public, anon, authenticated;
grant execute on function public.mms_sweep() to service_role;

notify pgrst, 'reload schema';
