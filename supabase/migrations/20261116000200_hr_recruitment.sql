-- =============================================================================
-- HR Recruitment Management. Safe to run again; nothing is deleted.
--
-- The CRM had no candidate tables (the old "Recruitment Management" card on the HR dashboard counted a hard-coded "2 Active Candidates"
-- and listed offer letters kept in the browser), so these are new. They sit next to the existing HR employee records and use the same
-- accounts for "who is responsible" (an HR employee is a CRM profile of the HR department).
--
-- Three DIFFERENT things are tracked per candidate, never merged into one generic status:
--   Pending       what is still outstanding: interviews, documents, checks ... (hr_candidate_actions, each with a due date and a person)
--   Call          the call side: the next scheduled call, the last outcome and the follow-up date (hr_candidate_calls)
--   Confirmation  where the confirmation stands (not started / offer pending / offered / confirmed / declined / on hold) and its date
-- Every change is written to the candidate's history (hr_candidate_events). Only HR staff and the Super Admin can read or change any of it
-- (private.is_hr_staff()); the tables cannot be written directly, only through the functions below.
-- =============================================================================

create table if not exists public.hr_positions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 2 and 120),
  department_id uuid references public.departments(id) on delete set null,
  is_open boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hr_positions_title_key on public.hr_positions (lower(btrim(title)), coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.hr_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  position_id uuid not null references public.hr_positions(id) on delete restrict,
  source text check (source is null or length(source) <= 80),
  notes text check (notes is null or length(notes) <= 2000),
  owner_id uuid references public.profiles(id) on delete set null,       -- the responsible HR employee
  confirmation_status text not null default 'NOT_STARTED'
    check (confirmation_status in ('NOT_STARTED', 'OFFER_PENDING', 'OFFERED', 'CONFIRMED', 'DECLINED', 'ON_HOLD')),
  confirmation_date date,
  confirmation_note text check (confirmation_note is null or length(confirmation_note) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- the same person can apply for two positions, but not twice for the same one
create unique index if not exists hr_candidates_email_position_key on public.hr_candidates (lower(email), position_id);
create index if not exists hr_candidates_position_idx on public.hr_candidates (position_id);
create index if not exists hr_candidates_owner_idx on public.hr_candidates (owner_id) where owner_id is not null;

create table if not exists public.hr_candidate_actions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hr_candidates(id) on delete cascade,
  kind text not null check (kind in ('INTERVIEW', 'DOCUMENTS', 'ASSESSMENT', 'BACKGROUND_CHECK', 'REFERENCE_CHECK', 'OTHER')),
  title text not null check (length(btrim(title)) between 2 and 200),
  due_date date,
  assignee_id uuid references public.profiles(id) on delete set null,    -- the HR employee responsible for this action
  status text not null default 'OPEN' check (status in ('OPEN', 'DONE', 'CANCELLED')),
  note text check (note is null or length(note) <= 500),
  done_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hr_candidate_actions_candidate_idx on public.hr_candidate_actions (candidate_id, status);
create index if not exists hr_candidate_actions_open_idx on public.hr_candidate_actions (due_date) where status = 'OPEN';

create table if not exists public.hr_candidate_calls (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hr_candidates(id) on delete cascade,
  scheduled_at timestamptz,                                              -- when the call is planned (null for a call that was simply logged)
  called_at timestamptz,                                                 -- when it was made (null until then)
  outcome text check (outcome in ('ANSWERED', 'NO_ANSWER', 'CALL_BACK', 'NOT_INTERESTED', 'WRONG_NUMBER')),
  note text check (note is null or length(note) <= 1000),
  follow_up_date date,
  made_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hr_candidate_calls_state check ((called_at is null and outcome is null and scheduled_at is not null) or (called_at is not null and outcome is not null))
);
create index if not exists hr_candidate_calls_candidate_idx on public.hr_candidate_calls (candidate_id, created_at desc);

create table if not exists public.hr_candidate_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hr_candidates(id) on delete cascade,
  kind text not null,
  summary text not null check (length(summary) <= 300),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists hr_candidate_events_candidate_idx on public.hr_candidate_events (candidate_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['hr_positions', 'hr_candidates', 'hr_candidate_actions', 'hr_candidate_calls', 'hr_candidate_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_hr_staff())', t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop trigger if exists hr_candidates_set_updated_at on public.hr_candidates;
create trigger hr_candidates_set_updated_at before update on public.hr_candidates for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.rec_event(p_candidate uuid, p_kind text, p_summary text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_candidate_events (candidate_id, kind, summary, detail, actor_id, actor_name)
  select p_candidate, p_kind, left(p_summary, 300), coalesce(p_detail, '{}'::jsonb), p.id, p.full_name
    from (select 1) x left join public.profiles p on p.id = private.my_id()
$$;
revoke all on function private.rec_event(uuid, text, text, jsonb) from public, anon, authenticated;

-- The three columns of a candidate, each calculated from its own records.
create or replace function private.rec_summary(c public.hr_candidates)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
  v_open integer;
  v_overdue integer;
  v_next_due date;
  v_items jsonb;
  v_next_call timestamptz;
  v_last public.hr_candidate_calls;
  v_newer boolean := false;
  v_calls integer;
  v_missed integer;
begin
  select count(*), count(*) filter (where a.due_date < v_today), min(a.due_date)
    into v_open, v_overdue, v_next_due from public.hr_candidate_actions a where a.candidate_id = c.id and a.status = 'OPEN';
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'dueDate', x.due_date, 'overdue', x.due_date < v_today,
                                               'assignee', (select p.full_name from public.profiles p where p.id = x.assignee_id)) order by x.due_date nulls last, x.created_at), '[]'::jsonb)
    into v_items from (select * from public.hr_candidate_actions a where a.candidate_id = c.id and a.status = 'OPEN' order by a.due_date nulls last, a.created_at limit 3) x;

  select min(k.scheduled_at) filter (where k.called_at is null and k.scheduled_at >= now()),
         count(*) filter (where k.called_at is null and k.scheduled_at < now()),
         count(*)
    into v_next_call, v_missed, v_calls from public.hr_candidate_calls k where k.candidate_id = c.id;
  select * into v_last from public.hr_candidate_calls k where k.candidate_id = c.id and k.called_at is not null order by k.called_at desc limit 1;
  if v_last.id is not null and v_last.follow_up_date is not null then
    -- a follow-up is outstanding until a later call is scheduled or made
    select exists (select 1 from public.hr_candidate_calls k where k.candidate_id = c.id and k.created_at > v_last.created_at) into v_newer;
  end if;

  return jsonb_build_object(
    'pending', jsonb_build_object('open', v_open, 'overdue', v_overdue, 'nextDue', v_next_due, 'items', v_items),
    'call', jsonb_build_object(
      'total', v_calls, 'nextAt', v_next_call, 'missedScheduled', v_missed,
      'last', case when v_last.id is null then null else jsonb_build_object('outcome', v_last.outcome, 'at', v_last.called_at, 'followUpDate', v_last.follow_up_date, 'note', v_last.note) end,
      'followUpOverdue', (v_last.id is not null and v_last.follow_up_date is not null and v_last.follow_up_date < v_today and not v_newer)),
    'confirmation', jsonb_build_object('status', c.confirmation_status, 'date', c.confirmation_date, 'note', c.confirmation_note));
end $$;
revoke all on function private.rec_summary(public.hr_candidates) from public, anon, authenticated;

create or replace function private.rec_candidate_json(c public.hr_candidates)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'source', c.source, 'notes', c.notes,
    'positionId', c.position_id, 'position', (select p.title from public.hr_positions p where p.id = c.position_id),
    'ownerId', c.owner_id, 'owner', (select o.full_name from public.profiles o where o.id = c.owner_id),
    'createdAt', c.created_at, 'updatedAt', c.updated_at) || private.rec_summary(c)
$$;
revoke all on function private.rec_candidate_json(public.hr_candidates) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
create or replace function public.hr_positions_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'departmentId', p.department_id,
           'department', (select d.name from public.departments d where d.id = p.department_id), 'isOpen', p.is_open,
           'candidates', (select count(*) from public.hr_candidates c where c.position_id = p.id)) order by p.is_open desc, p.title)
         from public.hr_positions p), '[]'::jsonb);
end $$;

-- The HR employees a candidate or an action can be given to.
create or replace function public.hr_recruiters()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'position', p.position) order by p.full_name)
                     from public.profiles p join public.departments d on d.id = p.department_id
                    where d.slug = 'hr' and p.status = 'ACTIVE'), '[]'::jsonb);
end $$;

create or replace function public.hr_recruitment_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return jsonb_build_object(
    'today', v_today,
    'candidates', (select count(*) from public.hr_candidates),
    'withPending', (select count(distinct a.candidate_id) from public.hr_candidate_actions a where a.status = 'OPEN'),
    'overdueActions', (select count(*) from public.hr_candidate_actions a where a.status = 'OPEN' and a.due_date < v_today),
    'upcomingCalls', (select count(*) from public.hr_candidate_calls k where k.called_at is null and k.scheduled_at >= now() and k.scheduled_at < now() + interval '7 days'),
    'overdueFollowUps', (select count(*) from public.hr_candidates c where (private.rec_summary(c) -> 'call' ->> 'followUpOverdue')::boolean),
    'missedCalls', (select count(*) from public.hr_candidate_calls k where k.called_at is null and k.scheduled_at < now()),
    'confirmed', (select count(*) from public.hr_candidates c where c.confirmation_status = 'CONFIRMED'),
    'openPositions', (select count(*) from public.hr_positions p where p.is_open));
end $$;

create or replace function public.hr_recruitment_list(
  p_search text default null, p_position uuid default null, p_confirmation text default null, p_pending text default null,
  p_call text default null, p_owner uuid default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_total bigint;
  v_items jsonb;
begin
  perform private.hr_require_staff();
  if p_confirmation is not null and p_confirmation not in ('NOT_STARTED', 'OFFER_PENDING', 'OFFERED', 'CONFIRMED', 'DECLINED', 'ON_HOLD') then
    raise exception 'VALIDATION_ERROR: Unknown confirmation status.' using errcode = 'P0001';
  end if;
  if p_pending is not null and p_pending not in ('OPEN', 'OVERDUE', 'NONE') then raise exception 'VALIDATION_ERROR: Unknown pending filter.' using errcode = 'P0001'; end if;
  if p_call is not null and p_call not in ('SCHEDULED', 'FOLLOW_UP_OVERDUE', 'NONE') then raise exception 'VALIDATION_ERROR: Unknown call filter.' using errcode = 'P0001'; end if;

  with rows as (
    select c.id, c.created_at, private.rec_candidate_json(c) as j
      from public.hr_candidates c
     where (v_q = '' or position(v_q in lower(c.name)) > 0 or position(v_q in lower(c.email)) > 0)
       and (p_position is null or c.position_id = p_position)
       and (p_confirmation is null or c.confirmation_status = p_confirmation)
       and (p_owner is null or c.owner_id = p_owner)),
  f as (
    select * from rows r
     where (p_pending is null or (p_pending = 'OPEN' and (r.j -> 'pending' ->> 'open')::int > 0)
                              or (p_pending = 'NONE' and (r.j -> 'pending' ->> 'open')::int = 0)
                              or (p_pending = 'OVERDUE' and (r.j -> 'pending' ->> 'overdue')::int > 0))
       and (p_call is null or (p_call = 'SCHEDULED' and (r.j -> 'call' ->> 'nextAt') is not null)
                           or (p_call = 'FOLLOW_UP_OVERDUE' and ((r.j -> 'call' ->> 'followUpOverdue')::boolean or (r.j -> 'call' ->> 'missedScheduled')::int > 0))
                           or (p_call = 'NONE' and (r.j -> 'call' ->> 'total')::int = 0)))
  select (select count(*) from f),
         coalesce((select jsonb_agg(x.j order by x.created_at desc, x.id)
                     from (select * from f order by created_at desc, id limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))) x), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

create or replace function public.hr_recruitment_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hr_candidates;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_id;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  return private.rec_candidate_json(c) || jsonb_build_object(
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title, 'dueDate', a.due_date, 'status', a.status, 'note', a.note, 'doneAt', a.done_at,
                     'assigneeId', a.assignee_id, 'assignee', (select p.full_name from public.profiles p where p.id = a.assignee_id), 'overdue', a.status = 'OPEN' and a.due_date < private.hr_today(),
                     'createdAt', a.created_at) order by (a.status = 'OPEN') desc, a.due_date nulls last, a.created_at desc)
                  from public.hr_candidate_actions a where a.candidate_id = c.id), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'scheduledAt', k.scheduled_at, 'calledAt', k.called_at, 'outcome', k.outcome, 'note', k.note, 'followUpDate', k.follow_up_date,
                     'madeBy', (select p.full_name from public.profiles p where p.id = k.made_by)) order by k.created_at desc)
                  from public.hr_candidate_calls k where k.candidate_id = c.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'summary', e.summary, 'actor', e.actor_name, 'at', e.created_at) order by e.created_at desc, e.id)
                  from (select * from public.hr_candidate_events ev where ev.candidate_id = c.id order by ev.created_at desc limit 100) e), '[]'::jsonb));
end $$;

-- Upcoming calls, overdue follow-ups and overdue actions in one place.
create or replace function public.hr_recruitment_agenda()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return jsonb_build_object(
    'upcomingCalls', coalesce((select jsonb_agg(jsonb_build_object('candidateId', c.id, 'name', c.name, 'position', (select p.title from public.hr_positions p where p.id = c.position_id), 'at', k.scheduled_at, 'callId', k.id) order by k.scheduled_at)
        from public.hr_candidate_calls k join public.hr_candidates c on c.id = k.candidate_id where k.called_at is null and k.scheduled_at >= now() and k.scheduled_at < now() + interval '14 days'), '[]'::jsonb),
    'overdueCalls', coalesce((select jsonb_agg(jsonb_build_object('candidateId', c.id, 'name', c.name, 'position', (select p.title from public.hr_positions p where p.id = c.position_id), 'at', k.scheduled_at, 'callId', k.id) order by k.scheduled_at)
        from public.hr_candidate_calls k join public.hr_candidates c on c.id = k.candidate_id where k.called_at is null and k.scheduled_at < now()), '[]'::jsonb),
    'overdueFollowUps', coalesce((select jsonb_agg(jsonb_build_object('candidateId', x.id, 'name', x.name, 'position', x.pos_title, 'followUpDate', x.fu) order by x.fu)
        from (select c.id, c.name, (select p.title from public.hr_positions p where p.id = c.position_id) as pos_title, (private.rec_summary(c) -> 'call' -> 'last' ->> 'followUpDate')::date as fu
                from public.hr_candidates c where (private.rec_summary(c) -> 'call' ->> 'followUpOverdue')::boolean) x where x.fu is not null and x.fu < v_today), '[]'::jsonb),
    'overdueActions', coalesce((select jsonb_agg(jsonb_build_object('candidateId', c.id, 'name', c.name, 'actionId', a.id, 'title', a.title, 'dueDate', a.due_date,
                                   'assignee', (select p.full_name from public.profiles p where p.id = a.assignee_id)) order by a.due_date)
        from public.hr_candidate_actions a join public.hr_candidates c on c.id = a.candidate_id where a.status = 'OPEN' and a.due_date < v_today), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Writing (HR staff only; each change is written to the candidate's history)
-- ---------------------------------------------------------------------------
create or replace function public.hr_position_save(p_id uuid, p_title text, p_department uuid default null, p_open boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_positions;
begin
  perform private.hr_require_staff();
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the position title.' using errcode = 'P0001'; end if;
  begin
    if p_id is null then
      insert into public.hr_positions (title, department_id, is_open, created_by) values (btrim(p_title), p_department, coalesce(p_open, true), private.my_id()) returning * into r;
    else
      update public.hr_positions set title = btrim(p_title), department_id = p_department, is_open = coalesce(p_open, true), updated_at = now() where id = p_id returning * into r;
      if r.id is null then raise exception 'NOT_FOUND: Position not found.' using errcode = 'P0001'; end if;
    end if;
  exception when unique_violation then
    raise exception 'CONFLICT: This position already exists.' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', r.id, 'title', r.title, 'isOpen', r.is_open);
end $$;

create or replace function public.hr_candidate_save(
  p_id uuid, p_name text, p_email text, p_phone text, p_position uuid, p_owner uuid default null, p_source text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  o public.hr_candidates;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_title text;
  v_changes text[] := '{}';
begin
  perform private.hr_require_staff();
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the candidate''s name.' using errcode = 'P0001'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001'; end if;
  select title into v_title from public.hr_positions where id = p_position;
  if v_title is null then raise exception 'VALIDATION_ERROR: Choose the position the candidate applied for.' using errcode = 'P0001'; end if;
  if p_owner is not null and not exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id where p.id = p_owner and d.slug = 'hr' and p.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: The responsible person must be an active HR employee.' using errcode = 'P0001';
  end if;
  begin
    if p_id is null then
      insert into public.hr_candidates (name, email, phone, position_id, source, notes, owner_id, created_by)
      values (btrim(p_name), v_email, nullif(btrim(coalesce(p_phone, '')), ''), p_position, nullif(btrim(coalesce(p_source, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), p_owner, private.my_id())
      returning * into c;
      perform private.rec_event(c.id, 'CREATED', format('Added for %s', v_title), jsonb_build_object('position', v_title));
      if p_owner is not null then
        perform private.notify(p_owner, 'RECRUITMENT_ASSIGNED', format('Candidate assigned to you: %s', c.name), format('For the position %s', v_title), 'hr_candidate', c.id);
      end if;
    else
      select * into o from public.hr_candidates where id = p_id for update;
      if o.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
      update public.hr_candidates
         set name = btrim(p_name), email = v_email, phone = nullif(btrim(coalesce(p_phone, '')), ''), position_id = p_position,
             source = nullif(btrim(coalesce(p_source, '')), ''), notes = nullif(btrim(coalesce(p_notes, '')), ''), owner_id = p_owner
       where id = p_id returning * into c;
      if o.name is distinct from c.name then v_changes := v_changes || 'name'::text; end if;
      if o.email is distinct from c.email then v_changes := v_changes || 'e-mail'::text; end if;
      if o.phone is distinct from c.phone then v_changes := v_changes || 'phone'::text; end if;
      if o.position_id is distinct from c.position_id then v_changes := v_changes || format('position (now %s)', v_title); end if;
      if o.owner_id is distinct from c.owner_id then
        v_changes := v_changes || 'responsible HR employee'::text;
        perform private.notify(c.owner_id, 'RECRUITMENT_ASSIGNED', format('Candidate assigned to you: %s', c.name), format('For the position %s', v_title), 'hr_candidate', c.id);
      end if;
      if o.source is distinct from c.source or o.notes is distinct from c.notes then v_changes := v_changes || 'details'::text; end if;
      if array_length(v_changes, 1) > 0 then
        perform private.rec_event(c.id, 'UPDATED', 'Updated: ' || array_to_string(v_changes, ', '), jsonb_build_object('changed', to_jsonb(v_changes)));
      end if;
    end if;
  exception when unique_violation then
    raise exception 'CONFLICT: A candidate with this e-mail address already applied for this position.' using errcode = 'P0001';
  end;
  return private.rec_candidate_json(c);
end $$;

create or replace function public.hr_candidate_action_add(p_candidate uuid, p_kind text, p_title text, p_due date default null, p_assignee uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  a public.hr_candidate_actions;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_candidate;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  if p_kind not in ('INTERVIEW', 'DOCUMENTS', 'ASSESSMENT', 'BACKGROUND_CHECK', 'REFERENCE_CHECK', 'OTHER') then raise exception 'VALIDATION_ERROR: Choose what is pending.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'VALIDATION_ERROR: Describe what is pending.' using errcode = 'P0001'; end if;
  if p_assignee is not null and not exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id where p.id = p_assignee and d.slug = 'hr' and p.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: The responsible person must be an active HR employee.' using errcode = 'P0001';
  end if;
  insert into public.hr_candidate_actions (candidate_id, kind, title, due_date, assignee_id, created_by)
  values (c.id, p_kind, btrim(p_title), p_due, coalesce(p_assignee, c.owner_id), private.my_id()) returning * into a;
  perform private.rec_event(c.id, 'PENDING_ADDED', format('Pending: %s%s', a.title, case when a.due_date is null then '' else format(' (due %s)', to_char(a.due_date, 'DD Mon YYYY')) end), jsonb_build_object('kind', a.kind));
  perform private.notify(a.assignee_id, 'RECRUITMENT_TASK', format('Recruitment task: %s', a.title), format('%s%s', c.name, case when a.due_date is null then '' else format(' · due %s', to_char(a.due_date, 'DD Mon')) end), 'hr_candidate', c.id);
  return jsonb_build_object('id', a.id);
end $$;

create or replace function public.hr_candidate_action_close(p_action uuid, p_done boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_candidate_actions;
begin
  perform private.hr_require_staff();
  select * into a from public.hr_candidate_actions where id = p_action for update;
  if a.id is null then raise exception 'NOT_FOUND: Pending item not found.' using errcode = 'P0001'; end if;
  if a.status <> 'OPEN' then raise exception 'CONFLICT: This item is already closed.' using errcode = 'P0001'; end if;
  update public.hr_candidate_actions set status = case when p_done then 'DONE' else 'CANCELLED' end, done_at = now(), note = left(nullif(btrim(coalesce(p_note, '')), ''), 500) where id = a.id returning * into a;
  perform private.rec_event(a.candidate_id, case when p_done then 'PENDING_DONE' else 'PENDING_CANCELLED' end, format('%s: %s', case when p_done then 'Done' else 'Cancelled' end, a.title));
  return jsonb_build_object('id', a.id, 'status', a.status);
end $$;

create or replace function public.hr_candidate_call_schedule(p_candidate uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  k public.hr_candidate_calls;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_candidate;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  if p_at is null or p_at < now() - interval '1 hour' or p_at > now() + interval '1 year' then raise exception 'VALIDATION_ERROR: Choose a time for the call (not in the past).' using errcode = 'P0001'; end if;
  insert into public.hr_candidate_calls (candidate_id, scheduled_at, created_by) values (c.id, p_at, private.my_id()) returning * into k;
  perform private.rec_event(c.id, 'CALL_SCHEDULED', format('Call scheduled for %s', to_char(p_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')));
  return jsonb_build_object('id', k.id);
end $$;

-- Record a call that was made. With p_call the planned call is completed; without it a call that was not planned is logged.
create or replace function public.hr_candidate_call_record(p_candidate uuid, p_call uuid, p_outcome text, p_note text default null, p_follow_up date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  k public.hr_candidate_calls;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_candidate;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  if p_outcome not in ('ANSWERED', 'NO_ANSWER', 'CALL_BACK', 'NOT_INTERESTED', 'WRONG_NUMBER') then raise exception 'VALIDATION_ERROR: Choose the outcome of the call.' using errcode = 'P0001'; end if;
  if p_follow_up is not null and (p_follow_up < private.hr_today() - 1 or p_follow_up > private.hr_today() + 366) then raise exception 'VALIDATION_ERROR: Enter a valid follow-up date.' using errcode = 'P0001'; end if;
  if p_call is not null then
    update public.hr_candidate_calls set called_at = now(), outcome = p_outcome, note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000), follow_up_date = p_follow_up, made_by = private.my_id()
     where id = p_call and candidate_id = c.id and called_at is null returning * into k;
    if k.id is null then raise exception 'NOT_FOUND: That planned call was not found (or was already recorded).' using errcode = 'P0001'; end if;
  else
    insert into public.hr_candidate_calls (candidate_id, called_at, outcome, note, follow_up_date, made_by, created_by)
    values (c.id, now(), p_outcome, left(nullif(btrim(coalesce(p_note, '')), ''), 1000), p_follow_up, private.my_id(), private.my_id()) returning * into k;
  end if;
  perform private.rec_event(c.id, 'CALL_RECORDED', format('Call: %s%s', initcap(replace(lower(p_outcome), '_', ' ')), case when p_follow_up is null then '' else format(' · follow up %s', to_char(p_follow_up, 'DD Mon YYYY')) end),
                            jsonb_build_object('outcome', p_outcome));
  return jsonb_build_object('id', k.id);
end $$;

create or replace function public.hr_candidate_confirmation_set(p_candidate uuid, p_status text, p_date date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
begin
  perform private.hr_require_staff();
  if p_status not in ('NOT_STARTED', 'OFFER_PENDING', 'OFFERED', 'CONFIRMED', 'DECLINED', 'ON_HOLD') then raise exception 'VALIDATION_ERROR: Choose the confirmation status.' using errcode = 'P0001'; end if;
  if p_status in ('OFFERED', 'CONFIRMED', 'DECLINED') and p_date is null then raise exception 'VALIDATION_ERROR: Enter the date of the offer, confirmation or decision.' using errcode = 'P0001'; end if;
  update public.hr_candidates
     set confirmation_status = p_status, confirmation_date = case when p_status = 'NOT_STARTED' then null else p_date end, confirmation_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
   where id = p_candidate returning * into c;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  perform private.rec_event(c.id, 'CONFIRMATION', format('Confirmation: %s%s', initcap(replace(lower(p_status), '_', ' ')), case when c.confirmation_date is null then '' else format(' (%s)', to_char(c.confirmation_date, 'DD Mon YYYY')) end),
                            jsonb_build_object('status', p_status));
  return private.rec_candidate_json(c);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'hr_positions_list()', 'hr_recruiters()', 'hr_recruitment_overview()', 'hr_recruitment_list(text, uuid, text, text, text, uuid, integer, integer)',
    'hr_recruitment_get(uuid)', 'hr_recruitment_agenda()', 'hr_position_save(uuid, text, uuid, boolean)',
    'hr_candidate_save(uuid, text, text, text, uuid, uuid, text, text)', 'hr_candidate_action_add(uuid, text, text, date, uuid)',
    'hr_candidate_action_close(uuid, boolean, text)', 'hr_candidate_call_schedule(uuid, timestamptz)',
    'hr_candidate_call_record(uuid, uuid, text, text, date)', 'hr_candidate_confirmation_set(uuid, text, date, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
