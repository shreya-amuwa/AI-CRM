-- =============================================================================
-- Crocodial: connection health per server, and a scoped "Refresh" for every Sales dashboard. Run after 20270117000200_crocodial_field_alignment.sql.
-- Safe to run twice.
--
-- 1. Which server sees the token (crocodial_runtime_reports). The token is a setting of each server that runs the CRM (the Cloudflare
--    Worker, and any Vercel deployment still connected). Each server records whether IT has the setting (yes / no and whether its format
--    is valid; never the value). A server WITHOUT the token no longer overwrites the connection's health while another server that has it
--    reported recently: before this, a second deployment that received the scheduled call wrote "The server has no ... setting" over a
--    working connection. The Super Admin sees every server's report (croc_connection_health).
--
-- 2. "Refresh" for every Sales role (croc_refresh_request / croc_refresh_status / croc_refresh_capabilities). One account-level read per
--    Crocodial connection serves everybody; a refresh only asks for that read sooner. Who may refresh whom is exactly who may SEE whom
--    (private.croc_can_view, unchanged): the person, their own Team Lead, a Department / Operations Head whose Sales scope covers the
--    department, the Super Admin. The browser names only a scope (SELF / TEAM / DEPARTMENT / ALL); the people and connections are worked
--    out here from the signed-in account. Requests on one connection are coalesced: a read running, asked for in the last minute, or
--    completed in the last 2 minutes is joined, never repeated. Every request is audited. The Super Admin's "Sync now" is unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. What each server sees
-- ---------------------------------------------------------------------------
create table if not exists public.crocodial_runtime_reports (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  runtime text not null check (runtime ~ '^[a-z0-9][a-z0-9:._-]{0,79}$'),
  platform text not null check (platform in ('cloudflare', 'vercel', 'node')),
  environment text check (environment is null or length(environment) <= 40),
  deployment text check (deployment is null or length(deployment) <= 80),
  host text check (host is null or length(host) <= 120),
  credential_detected boolean not null,
  credential_format_valid boolean not null,
  context text not null check (context in ('PAGE', 'TEST', 'SYNC', 'REFRESH')),
  reported_at timestamptz not null default now(),
  primary key (connection_id, runtime)
);
alter table public.crocodial_runtime_reports enable row level security;
revoke all on public.crocodial_runtime_reports from public, anon, authenticated;

-- the server (service role) records what it sees; returns whether ANOTHER server had a valid token in the last 6 hours
create or replace function public.croc_runtime_report(p_connection uuid, p_runtime jsonb, p_detected boolean, p_valid boolean, p_context text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_runtime text := left(lower(coalesce(p_runtime ->> 'runtime', '')), 80);
  v_platform text := coalesce(p_runtime ->> 'platform', 'node');
begin
  if v_runtime !~ '^[a-z0-9][a-z0-9:._-]{0,79}$' or v_platform not in ('cloudflare', 'vercel', 'node') then
    raise exception 'VALIDATION_ERROR: Unknown runtime.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.crocodial_connections where id = p_connection) then
    return jsonb_build_object('recorded', false, 'otherHasCredential', false);
  end if;
  insert into public.crocodial_runtime_reports (connection_id, runtime, platform, environment, deployment, host, credential_detected,
                                                credential_format_valid, context, reported_at)
  values (p_connection, v_runtime, v_platform, left(p_runtime ->> 'environment', 40), left(p_runtime ->> 'deployment', 80),
          left(p_runtime ->> 'host', 120), coalesce(p_detected, false), coalesce(p_valid, false), coalesce(p_context, 'PAGE'), now())
  on conflict (connection_id, runtime) do update set platform = excluded.platform, environment = excluded.environment,
    deployment = excluded.deployment, host = coalesce(excluded.host, crocodial_runtime_reports.host),
    credential_detected = excluded.credential_detected, credential_format_valid = excluded.credential_format_valid,
    context = excluded.context, reported_at = now();
  return jsonb_build_object('recorded', true, 'otherHasCredential', exists (
    select 1 from public.crocodial_runtime_reports r
     where r.connection_id = p_connection and r.runtime <> v_runtime and r.credential_detected and r.credential_format_valid
       and r.reported_at > now() - interval '6 hours'));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Refresh requests
-- ---------------------------------------------------------------------------
alter table public.crocodial_connections add column if not exists refresh_requested_at timestamptz;

create table if not exists public.crocodial_refresh_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  scope text not null check (scope in ('SELF', 'TEAM', 'DEPARTMENT', 'ALL')),
  department_id uuid references public.departments (id) on delete set null,
  connection_ids uuid[] not null default '{}',
  people integer not null default 0 check (people >= 0),
  outcome text not null check (outcome in ('QUEUED', 'JOINED', 'UP_TO_DATE')),
  requested_at timestamptz not null default now()
);
create index if not exists crocodial_refresh_requests_by_idx on public.crocodial_refresh_requests (requested_by, requested_at desc);
alter table public.crocodial_refresh_requests enable row level security;
revoke all on public.crocodial_refresh_requests from public, anon, authenticated;

create or replace function private.croc_caller_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE')
$$;

-- the caller's kind of view, for the dashboards' wording only (the rules are below)
create or replace function private.croc_viewer_kind()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.role = 'SUPER_ADMIN' then 'SUPER_ADMIN'
    when p.role = 'DEPARTMENT_HEAD' and p.is_operations_head then 'OPERATIONS_HEAD'
    when p.role = 'DEPARTMENT_HEAD' then 'DEPARTMENT_HEAD'
    when p.role = 'TEAM_HEAD' then 'TEAM_LEAD'
    else 'EMPLOYEE' end
    from public.profiles p where p.id = auth.uid()
$$;

-- the connected people (approved mapping in effect, person active, connection + department link + rollout on) a scope covers for the
-- caller. Each one passes private.croc_can_view: a refresh never reaches further than the caller may already see.
create or replace function private.croc_refresh_people(p_scope text, p_department uuid default null)
returns table (profile_id uuid, connection_id uuid, department_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct m.profile_id, m.connection_id, m.department_id
    from public.crocodial_employee_mappings m
    join public.profiles p on p.id = m.profile_id and p.status = 'ACTIVE'
    join public.crocodial_connections c on c.id = m.connection_id and c.enabled
    join public.crocodial_department_links l on l.connection_id = m.connection_id and l.department_id = m.department_id and l.division = m.division and l.enabled
    join public.crocodial_rollout ro on ro.department_id = m.department_id and ro.division = m.division and ro.allowed
   where private.croc_caller_active()
     and m.status = 'APPROVED' and m.ended_at is null and m.effective_from is not null and m.effective_from <= now()
     and private.croc_can_view(m.profile_id, m.department_id, m.division)
     and case p_scope
           when 'SELF' then m.profile_id = auth.uid()
           when 'TEAM' then private.my_role() = 'TEAM_HEAD' and m.profile_id <> auth.uid()
           when 'DEPARTMENT' then private.my_role() in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') and p_department is not null and m.department_id = p_department
           when 'ALL' then private.my_role() in ('DEPARTMENT_HEAD', 'SUPER_ADMIN')
           else false end
$$;

-- one connection's data: the oldest complete read of its four kinds of data (null until all four have been read), a read running now,
-- a large read still in progress (continues on the next run)
create or replace function private.croc_connection_freshness(p_connection uuid, out o_last_ok timestamptz, out o_running boolean, out o_in_progress boolean)
language sql stable security definer set search_path = '' as $$
  select case when count(*) filter (where s.last_ok_at is not null) >= 4 then min(s.last_ok_at) end,
         coalesce(bool_or(s.running_since is not null and s.running_since > now() - interval '10 minutes'), false),
         coalesce(bool_or(s.next_page is not null), false)
    from public.crocodial_sync_state s where s.connection_id = p_connection
$$;

-- the state of one request on one connection: what the dashboard shows while it waits
create or replace function private.croc_refresh_connection_state(p_connection uuid, p_at timestamptz)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
  f record;
  v_done boolean;
  v_failed boolean;
  v_touched boolean;
begin
  select * into c from public.crocodial_connections where id = p_connection;
  if c.id is null or not c.enabled then
    return 'DATA_UNAVAILABLE';
  end if;
  select * into f from private.croc_connection_freshness(p_connection);
  -- a problem recorded since the request is the answer (the token, Crocodial refusing, its limit)
  if c.last_attempt_at >= p_at and c.health = 'NO_CREDENTIAL' then return 'TOKEN_MISSING'; end if;
  if c.last_attempt_at >= p_at and c.health in ('AUTH_FAILED', 'DISABLED_AT_SOURCE') then return 'TOKEN_INVALID'; end if;
  if c.last_attempt_at >= p_at and c.health = 'RATE_LIMITED' then return 'RATE_LIMITED'; end if;
  if f.o_running then return 'SYNCING'; end if;
  select count(*) >= 4 and bool_and(s.last_ok_at >= p_at),
         bool_or(s.last_run_at >= p_at and s.last_error is not null),
         bool_or(s.last_run_at >= p_at)
    into v_done, v_failed, v_touched
    from public.crocodial_sync_state s where s.connection_id = p_connection;
  if coalesce(v_done, false) and not f.o_in_progress then return 'UP_TO_DATE'; end if;
  if coalesce(v_failed, false) then return 'SYNC_FAILED'; end if;
  if coalesce(v_touched, false) and f.o_in_progress then return 'PARTIALLY_SYNCED'; end if;
  return 'REFRESH_QUEUED';
end $$;

create or replace function private.croc_refresh_json(r public.crocodial_refresh_requests)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_states text[];
  v_state text;
  v_last timestamptz;
  v_never boolean;
begin
  if r.outcome = 'UP_TO_DATE' then
    v_states := array['UP_TO_DATE'];
  else
    select array_agg(private.croc_refresh_connection_state(x, r.requested_at)) into v_states from unnest(r.connection_ids) x;
  end if;
  -- the worst state wins: a token problem, a failure, the limit, then work still going on
  v_state := case
    when 'TOKEN_MISSING' = any(v_states) then 'TOKEN_MISSING'
    when 'TOKEN_INVALID' = any(v_states) then 'TOKEN_INVALID'
    when 'SYNC_FAILED' = any(v_states) then 'SYNC_FAILED'
    when 'RATE_LIMITED' = any(v_states) then 'RATE_LIMITED'
    when 'DATA_UNAVAILABLE' = any(v_states) then 'DATA_UNAVAILABLE'
    when 'SYNCING' = any(v_states) then 'SYNCING'
    when 'REFRESH_QUEUED' = any(v_states) then 'REFRESH_QUEUED'
    when 'PARTIALLY_SYNCED' = any(v_states) then 'PARTIALLY_SYNCED'
    else 'UP_TO_DATE' end;
  select min(f.o_last_ok), bool_or(f.o_last_ok is null) into v_last, v_never
    from unnest(r.connection_ids) x, private.croc_connection_freshness(x) f;
  return jsonb_build_object('id', r.id, 'scope', r.scope, 'departmentId', r.department_id, 'people', r.people,
    'connections', coalesce(array_length(r.connection_ids, 1), 0), 'outcome', r.outcome, 'requestedAt', r.requested_at,
    'state', v_state, 'finished', v_state not in ('SYNCING', 'REFRESH_QUEUED'),
    'lastSyncAt', case when coalesce(v_never, true) then null else v_last end);
end $$;

-- "Refresh": the signed-in employee asks for their scope to be read again. Returns the request, and (kick) the connections this request
-- started, which the server reads right away; joined / up-to-date connections are not read again.
create or replace function public.croc_refresh_request(p_scope text, p_department uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_last public.crocodial_refresh_requests;
  r public.crocodial_refresh_requests;
  v_conns uuid[];
  v_people integer;
  v_kick uuid[] := '{}';
  v_joined boolean := false;
  c public.crocodial_connections;
  f record;
  v_outcome text;
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if not private.croc_caller_active() then
    raise exception 'FORBIDDEN: Your account is not active.' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('SELF', 'TEAM', 'DEPARTMENT', 'ALL') then
    raise exception 'VALIDATION_ERROR: Unknown refresh scope.' using errcode = '22023';
  end if;
  if p_scope = 'DEPARTMENT' and p_department is null then
    raise exception 'VALIDATION_ERROR: Choose a department.' using errcode = '22023';
  end if;
  if p_scope <> 'DEPARTMENT' then
    p_department := null;
  end if;

  select array_agg(distinct x.connection_id), count(distinct x.profile_id) into v_conns, v_people
    from private.croc_refresh_people(p_scope, p_department) x;
  if coalesce(v_people, 0) = 0 then
    raise exception '%', case p_scope
      when 'SELF' then 'NOT_FOUND: Your Crocodial account is not connected to Amuwa CRM. Contact your administrator.'
      when 'TEAM' then 'NOT_FOUND: None of your team members is connected to Crocodial.'
      else 'NOT_FOUND: Nobody you oversee here is connected to Crocodial.' end using errcode = 'P0002';
  end if;

  -- the same request again within 30 seconds: the earlier one is returned (a double click never queues twice)
  select * into v_last from public.crocodial_refresh_requests
   where requested_by = v_me and scope = p_scope and department_id is not distinct from p_department and requested_at > now() - interval '30 seconds'
   order by requested_at desc limit 1;
  if v_last.id is not null then
    return private.croc_refresh_json(v_last) || jsonb_build_object('repeated', true, 'kick', '[]'::jsonb);
  end if;

  -- one read per connection for everybody: join a read that is running or was asked for in the last minute; skip one completed in the
  -- last 2 minutes; otherwise ask for one (the row lock makes simultaneous clicks queue once)
  for c in select * from public.crocodial_connections where id = any(v_conns) order by id for update loop
    select * into f from private.croc_connection_freshness(c.id);
    if f.o_running or c.refresh_requested_at > now() - interval '1 minute' or c.last_manual_sync_at > now() - interval '1 minute' then
      v_joined := true;
    elsif f.o_last_ok > now() - interval '2 minutes' and not f.o_in_progress then
      null;
    else
      update public.crocodial_connections set refresh_requested_at = now() where id = c.id;
      v_kick := v_kick || c.id;
    end if;
  end loop;
  v_outcome := case when cardinality(v_kick) > 0 then 'QUEUED' when v_joined then 'JOINED' else 'UP_TO_DATE' end;

  insert into public.crocodial_refresh_requests (requested_by, scope, department_id, connection_ids, people, outcome)
  values (v_me, p_scope, p_department, v_conns, v_people, v_outcome) returning * into r;
  perform private.write_audit('CROCODIAL_REFRESH_REQUESTED', 'crocodial_refresh_request', r.id, p_department, null,
    jsonb_build_object('scope', p_scope, 'people', v_people, 'connections', cardinality(v_conns), 'outcome', v_outcome));
  return private.croc_refresh_json(r) || jsonb_build_object('repeated', false, 'kick', to_jsonb(v_kick));
end $$;

-- the state of one request: for the person who asked (or the Super Admin); nobody else learns it exists
create or replace function public.croc_refresh_status(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.crocodial_refresh_requests;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select * into r from public.crocodial_refresh_requests where id = p_id;
  if r.id is null or not (r.requested_by = auth.uid() or private.my_role() = 'SUPER_ADMIN') then
    raise exception 'NOT_FOUND: Refresh request not found.' using errcode = 'P0002';
  end if;
  return private.croc_refresh_json(r);
end $$;

-- which refresh buttons the caller has, and why one is missing. Counts come from approved mappings only; no Crocodial user, account or
-- connection detail is returned.
create or replace function public.croc_refresh_capabilities()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_kind text;
  v_self text;
  v_self_last timestamptz;
  v_team integer := 0;
  v_depts jsonb := '[]'::jsonb;
  v_all integer := 0;
  v_recent public.crocodial_refresh_requests;
  v_rollout boolean;
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  v_kind := coalesce(private.croc_viewer_kind(), 'EMPLOYEE');
  -- Crocodial is switched on for the caller's own department and Sales (so a person without a mapping there is told so; elsewhere
  -- nothing is shown at all)
  select exists (select 1 from public.profiles p
                   left join public.teams t on t.id = p.team_id
                   join public.crocodial_rollout ro on ro.department_id = p.department_id and ro.division = 'SALES' and ro.allowed
                   join public.crocodial_department_links l on l.department_id = p.department_id and l.division = 'SALES' and l.enabled
                   join public.crocodial_connections c on c.id = l.connection_id and c.enabled
                  where p.id = v_me and (t.division::text = 'SALES' or p.role = 'DEPARTMENT_HEAD'))
    into v_rollout;
  if not private.croc_caller_active() then
    return jsonb_build_object('kind', v_kind, 'active', false, 'rollout', false, 'self', jsonb_build_object('state', 'NOT_ENABLED'),
                              'team', null, 'departments', '[]'::jsonb, 'all', null, 'recent', null);
  end if;

  if exists (select 1 from private.croc_refresh_people('SELF')) then
    v_self := 'CONNECTED';
    select min(f.o_last_ok) into v_self_last from private.croc_refresh_people('SELF') x, private.croc_connection_freshness(x.connection_id) f;
  elsif exists (select 1 from public.crocodial_employee_mappings m where m.profile_id = v_me and m.status = 'PENDING') then
    v_self := 'PENDING_APPROVAL';
  elsif exists (select 1 from public.crocodial_employee_mappings m where m.profile_id = v_me and m.status = 'APPROVED' and m.ended_at is null) then
    v_self := 'NOT_ENABLED';
  else
    v_self := 'NOT_MAPPED';
  end if;

  if v_kind = 'TEAM_LEAD' then
    select count(distinct profile_id) into v_team from private.croc_refresh_people('TEAM');
  end if;
  if v_kind in ('DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then
    select coalesce(jsonb_agg(jsonb_build_object('departmentId', g.department_id, 'name', d.name, 'people', g.n, 'lastSyncAt', g.last_ok) order by d.name), '[]'::jsonb),
           coalesce(sum(g.n), 0)
      into v_depts, v_all
      from (select x.department_id, count(distinct x.profile_id) as n,
                   (select min(f.o_last_ok) from private.croc_refresh_people('ALL') y, private.croc_connection_freshness(y.connection_id) f
                     where y.department_id = x.department_id) as last_ok
              from private.croc_refresh_people('ALL') x group by x.department_id) g
      join public.departments d on d.id = g.department_id;
  end if;

  select * into v_recent from public.crocodial_refresh_requests
   where requested_by = v_me and requested_at > now() - interval '10 minutes' order by requested_at desc limit 1;

  return jsonb_build_object('kind', v_kind, 'active', true, 'rollout', coalesce(v_rollout, false),
    'self', jsonb_build_object('state', v_self, 'lastSyncAt', v_self_last),
    'team', case when v_kind = 'TEAM_LEAD' then jsonb_build_object('people', v_team) end,
    'departments', v_depts,
    'all', case when v_kind in ('DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then jsonb_build_object('people', v_all) end,
    'recent', case when v_recent.id is not null then private.croc_refresh_json(v_recent) end);
end $$;

-- the scheduled run also picks up a refresh that the server could not start at once (for example a server without the token)
create or replace function public.croc_sync_due(p_min_interval interval default interval '15 minutes', p_connection uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'credentialRef', c.credential_ref, 'timezone', c.timezone) order by c.created_at), '[]'::jsonb)
    from public.crocodial_connections c
   where private.croc_connection_syncable(c.id)
     and (p_connection is null or c.id = p_connection)
     and (p_connection is not null
          or not exists (select 1 from public.crocodial_sync_state s where s.connection_id = c.id and s.last_run_at > now() - p_min_interval and s.next_page is null)
          or exists (select 1 from public.crocodial_sync_state s where s.connection_id = c.id and s.next_page is not null)
          or (c.refresh_requested_at is not null
              and c.refresh_requested_at > coalesce((select min(s.last_run_at) from public.crocodial_sync_state s where s.connection_id = c.id), '-infinity'::timestamptz)))
$$;

-- ---------------------------------------------------------------------------
-- 3. The Super Admin's connection health: per connection, what every server reported, the sync, and the people it serves
-- ---------------------------------------------------------------------------
create or replace function public.croc_connection_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.croc_require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'connection', private.croc_connection_json(c),
      'syncable', private.croc_connection_syncable(c.id),
      'refreshRequestedAt', c.refresh_requested_at,
      'lastManualSyncAt', c.last_manual_sync_at,
      'lastSyncAt', (select f.o_last_ok from private.croc_connection_freshness(c.id) f),
      'syncRunning', (select f.o_running from private.croc_connection_freshness(c.id) f),
      'syncInProgress', (select f.o_in_progress from private.croc_connection_freshness(c.id) f),
      'lastSyncError', (select s.last_error from public.crocodial_sync_state s where s.connection_id = c.id and s.last_error is not null
                         order by s.last_run_at desc nulls last limit 1),
      'connectedPeople', (select count(distinct m.profile_id) from public.crocodial_employee_mappings m
                           where m.connection_id = c.id and m.status = 'APPROVED' and private.croc_mapping_live(m)),
      'refreshesToday', (select count(*) from public.crocodial_refresh_requests q where c.id = any(q.connection_ids) and q.requested_at > now() - interval '24 hours'),
      'runtimes', coalesce((select jsonb_agg(jsonb_build_object('runtime', r.runtime, 'platform', r.platform, 'environment', r.environment,
                    'deployment', r.deployment, 'host', r.host, 'credentialDetected', r.credential_detected,
                    'credentialFormatValid', r.credential_format_valid, 'context', r.context, 'reportedAt', r.reported_at) order by r.reported_at desc)
                  from public.crocodial_runtime_reports r where r.connection_id = c.id), '[]'::jsonb)
    ) order by c.created_at) from public.crocodial_connections c), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public.croc_refresh_request(text, uuid)', 'public.croc_refresh_status(uuid)', 'public.croc_refresh_capabilities()',
    'public.croc_connection_health()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.croc_runtime_report(uuid, jsonb, boolean, boolean, text)', 'public.croc_sync_due(interval, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['private.croc_caller_active()', 'private.croc_viewer_kind()', 'private.croc_refresh_people(text, uuid)',
    'private.croc_connection_freshness(uuid)', 'private.croc_refresh_connection_state(uuid, timestamptz)',
    'private.croc_refresh_json(public.crocodial_refresh_requests)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
