-- Run this ONE file once in the Supabase SQL editor (safe to run again). It is the migration 20261117000100_recruitment_dropdowns.sql.
-- It needs the earlier recruitment migration (the combined performance / recruitment / training file) to be applied already.

-- =============================================================================
-- Recruitment Management: the dropdowns now read the company's real records. Safe to run again; nothing is deleted.
--
--   Position: the positions HR added (hr_positions) PLUS every designation already in the employee records (the HR directory and the CRM
--   positions of active people). A designation that is not a position yet is offered as such and becomes one when it is chosen, so there is
--   no second list to keep in step and a new designation appears by itself.
--   Responsible HR employee: every active employee of the HR department from the HR directory (people with a CRM login and HR-directory
--   records without one), identified by their employee key. A person with a login is also notified; one without is recorded by name.
-- =============================================================================

alter table public.hr_candidates add column if not exists owner_key text;
alter table public.hr_candidates add column if not exists owner_name text;
alter table public.hr_candidate_actions add column if not exists assignee_key text;
alter table public.hr_candidate_actions add column if not exists assignee_name text;
update public.hr_candidates set owner_key = owner_id::text where owner_key is null and owner_id is not null;
update public.hr_candidate_actions set assignee_key = assignee_id::text where assignee_key is null and assignee_id is not null;

-- An active employee of the HR department, from the HR directory, by employee key.
create or replace function private.rec_hr_employee(p_key text)
returns table (r_key text, r_profile uuid, r_name text) language sql stable security definer set search_path = '' as $$
  select m.employee_key, m.profile_id, m.full_name
    from private.hr_mail_employees() m
   where m.employee_key = p_key and m.is_active and m.department_id = (select d.id from public.departments d where d.slug = 'hr')
$$;
revoke all on function private.rec_hr_employee(text) from public, anon, authenticated;

-- A position by its title: the existing one (any capitalisation) or a new one.
create or replace function private.rec_position_ensure(p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v uuid;
begin
  select id into v from public.hr_positions where lower(btrim(title)) = lower(btrim(p_title)) order by is_open desc, created_at limit 1;
  if v is null then
    insert into public.hr_positions (title, created_by) values (btrim(p_title), private.my_id()) returning id into v;
  end if;
  return v;
end $$;
revoke all on function private.rec_position_ensure(text) from public, anon, authenticated;

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
                                               'assignee', coalesce((select p.full_name from public.profiles p where p.id = x.assignee_id), x.assignee_name)) order by x.due_date nulls last, x.created_at), '[]'::jsonb)
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

create or replace function private.rec_candidate_json(c public.hr_candidates)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'source', c.source, 'notes', c.notes,
    'positionId', c.position_id, 'position', (select p.title from public.hr_positions p where p.id = c.position_id),
    'ownerId', c.owner_id, 'ownerKey', coalesce(c.owner_key, c.owner_id::text), 'owner', coalesce((select o.full_name from public.profiles o where o.id = c.owner_id), c.owner_name),
    'createdAt', c.created_at, 'updatedAt', c.updated_at) || private.rec_summary(c)
$$;
create or replace function public.hr_recruitment_list(
  p_search text default null, p_position uuid default null, p_confirmation text default null, p_pending text default null,
  p_call text default null, p_owner text default null, p_limit integer default 25, p_offset integer default 0)
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
       and (p_owner is null or coalesce(c.owner_key, c.owner_id::text) = p_owner)),
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
                     'assigneeId', a.assignee_id, 'assigneeKey', coalesce(a.assignee_key, a.assignee_id::text), 'assignee', coalesce((select p.full_name from public.profiles p where p.id = a.assignee_id), a.assignee_name), 'overdue', a.status = 'OPEN' and a.due_date < private.hr_today(),
                     'createdAt', a.created_at) order by (a.status = 'OPEN') desc, a.due_date nulls last, a.created_at desc)
                  from public.hr_candidate_actions a where a.candidate_id = c.id), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'scheduledAt', k.scheduled_at, 'calledAt', k.called_at, 'outcome', k.outcome, 'note', k.note, 'followUpDate', k.follow_up_date,
                     'madeBy', (select p.full_name from public.profiles p where p.id = k.made_by)) order by k.created_at desc)
                  from public.hr_candidate_calls k where k.candidate_id = c.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'summary', e.summary, 'actor', e.actor_name, 'at', e.created_at) order by e.created_at desc, e.id)
                  from (select * from public.hr_candidate_events ev where ev.candidate_id = c.id order by ev.created_at desc limit 100) e), '[]'::jsonb));
end $$;


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
                                   'assignee', coalesce((select p.full_name from public.profiles p where p.id = a.assignee_id), a.assignee_name)) order by a.due_date)
        from public.hr_candidate_actions a join public.hr_candidates c on c.id = a.candidate_id where a.status = 'OPEN' and a.due_date < v_today), '[]'::jsonb));
end $$;


-- Positions: the ones HR added, plus the designations of the employee records that are not positions yet (id null, source EMPLOYEES).
create or replace function public.hr_positions_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((select jsonb_agg(x order by (x ->> 'source') = 'POSITION' desc, not (x ->> 'isOpen')::boolean, lower(x ->> 'title')) from (
      select jsonb_build_object('id', p.id, 'title', p.title, 'departmentId', p.department_id, 'department', (select d.name from public.departments d where d.id = p.department_id),
                                'isOpen', p.is_open, 'candidates', (select count(*) from public.hr_candidates c where c.position_id = p.id), 'source', 'POSITION', 'employees', 0) as x
        from public.hr_positions p
      union all
      select jsonb_build_object('id', null, 'title', e.title, 'departmentId', null, 'department', null, 'isOpen', true, 'candidates', 0, 'source', 'EMPLOYEES', 'employees', e.n)
        from (select min(btrim(t.title)) as title, count(*) as n
                from (select h.designation as title from public.hr_employees h where coalesce(h.status, '') <> 'Left' and length(btrim(coalesce(h.designation, ''))) >= 2
                      union all
                      select p.position from public.profiles p where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN' and length(btrim(coalesce(p.position, ''))) >= 2) t
               group by lower(btrim(t.title))) e
       where not exists (select 1 from public.hr_positions p where lower(btrim(p.title)) = lower(e.title))) u), '[]'::jsonb);
end $$;

-- The HR employees a candidate or a pending item can be given to: every active employee of the HR department in the HR directory.
create or replace function public.hr_recruiters()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('employeeKey', m.employee_key, 'profileId', m.profile_id, 'name', m.full_name, 'code', m.employee_code,
                                  'designation', private.hr_designation(m.profile_id, m.hr_record_id), 'hasLogin', m.profile_id is not null) order by m.full_name)
                     from private.hr_mail_employees() m
                    where m.is_active and m.department_id = (select d.id from public.departments d where d.slug = 'hr')), '[]'::jsonb);
end $$;

create or replace function public.hr_candidate_save(
  p_id uuid, p_name text, p_email text, p_phone text, p_position uuid, p_position_title text, p_owner text default null, p_source text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  o public.hr_candidates;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_position uuid := p_position;
  v_title text;
  v_okey text;
  v_oprof uuid;
  v_oname text;
  v_changes text[] := '{}';
begin
  perform private.hr_require_staff();
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the candidate''s name.' using errcode = 'P0001'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001'; end if;
  if v_position is null and length(btrim(coalesce(p_position_title, ''))) >= 2 then v_position := private.rec_position_ensure(p_position_title); end if;
  select title into v_title from public.hr_positions where id = v_position;
  if v_title is null then raise exception 'VALIDATION_ERROR: Choose the position the candidate applied for.' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_owner, '')), '') is not null then
    select r_key, r_profile, r_name into v_okey, v_oprof, v_oname from private.rec_hr_employee(p_owner);
    if v_okey is null then raise exception 'VALIDATION_ERROR: The responsible person must be an active HR employee.' using errcode = 'P0001'; end if;
  end if;
  begin
    if p_id is null then
      insert into public.hr_candidates (name, email, phone, position_id, source, notes, owner_id, owner_key, owner_name, created_by)
      values (btrim(p_name), v_email, nullif(btrim(coalesce(p_phone, '')), ''), v_position, nullif(btrim(coalesce(p_source, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
              v_oprof, v_okey, v_oname, private.my_id())
      returning * into c;
      perform private.rec_event(c.id, 'CREATED', format('Added for %s', v_title), jsonb_build_object('position', v_title));
      if c.owner_id is not null then
        perform private.notify(c.owner_id, 'RECRUITMENT_ASSIGNED', format('Candidate assigned to you: %s', c.name), format('For the position %s', v_title), 'hr_candidate', c.id);
      end if;
    else
      select * into o from public.hr_candidates where id = p_id for update;
      if o.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
      update public.hr_candidates
         set name = btrim(p_name), email = v_email, phone = nullif(btrim(coalesce(p_phone, '')), ''), position_id = v_position,
             source = nullif(btrim(coalesce(p_source, '')), ''), notes = nullif(btrim(coalesce(p_notes, '')), ''),
             owner_id = v_oprof, owner_key = v_okey, owner_name = v_oname
       where id = p_id returning * into c;
      if o.name is distinct from c.name then v_changes := v_changes || 'name'::text; end if;
      if o.email is distinct from c.email then v_changes := v_changes || 'e-mail'::text; end if;
      if o.phone is distinct from c.phone then v_changes := v_changes || 'phone'::text; end if;
      if o.position_id is distinct from c.position_id then v_changes := v_changes || format('position (now %s)', v_title); end if;
      if coalesce(o.owner_key, o.owner_id::text) is distinct from c.owner_key then
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

create or replace function public.hr_candidate_action_add(p_candidate uuid, p_kind text, p_title text, p_due date default null, p_assignee text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  a public.hr_candidate_actions;
  v_key text;
  v_prof uuid;
  v_nm text;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_candidate;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  if p_kind not in ('INTERVIEW', 'DOCUMENTS', 'ASSESSMENT', 'BACKGROUND_CHECK', 'REFERENCE_CHECK', 'OTHER') then raise exception 'VALIDATION_ERROR: Choose what is pending.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'VALIDATION_ERROR: Describe what is pending.' using errcode = 'P0001'; end if;
  v_key := c.owner_key; v_prof := c.owner_id; v_nm := c.owner_name;
  if nullif(btrim(coalesce(p_assignee, '')), '') is not null then
    select r_key, r_profile, r_name into v_key, v_prof, v_nm from private.rec_hr_employee(p_assignee);
    if v_key is null then raise exception 'VALIDATION_ERROR: The responsible person must be an active HR employee.' using errcode = 'P0001'; end if;
  end if;
  insert into public.hr_candidate_actions (candidate_id, kind, title, due_date, assignee_id, assignee_key, assignee_name, created_by)
  values (c.id, p_kind, btrim(p_title), p_due, v_prof, v_key, v_nm, private.my_id()) returning * into a;
  perform private.rec_event(c.id, 'PENDING_ADDED', format('Pending: %s%s', a.title, case when a.due_date is null then '' else format(' (due %s)', to_char(a.due_date, 'DD Mon YYYY')) end), jsonb_build_object('kind', a.kind));
  perform private.notify(a.assignee_id, 'RECRUITMENT_TASK', format('Recruitment task: %s', a.title), format('%s%s', c.name, case when a.due_date is null then '' else format(' · due %s', to_char(a.due_date, 'DD Mon')) end), 'hr_candidate', c.id);
  return jsonb_build_object('id', a.id);
end $$;

drop function if exists public.hr_recruitment_list(text, uuid, text, text, text, uuid, integer, integer);
drop function if exists public.hr_candidate_save(uuid, text, text, text, uuid, uuid, text, text);
drop function if exists public.hr_candidate_action_add(uuid, text, text, date, uuid);

do $$ declare f text; begin
  foreach f in array array[
    'hr_positions_list()', 'hr_recruiters()', 'hr_recruitment_list(text, uuid, text, text, text, text, integer, integer)', 'hr_recruitment_get(uuid)', 'hr_recruitment_agenda()',
    'hr_candidate_save(uuid, text, text, text, uuid, text, text, text, text)', 'hr_candidate_action_add(uuid, text, text, date, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
