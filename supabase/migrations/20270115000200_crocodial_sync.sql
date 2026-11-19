-- =============================================================================
-- Crocodial integration, part 2: read-only synchronisation of leads, call logs, follow-ups and remarks
-- (docs/CROCODIAL_INTEGRATION.md). Run after 20270115000100_crocodial_integration.sql. Additive and safe to run twice.
--
-- * Copies are keyed by (connection, Crocodial id): two accounts never mix even when their numbers collide.
-- * Each record keeps the Crocodial user it is attributed to, exactly as Crocodial reports it (calls: called_by, follow-ups: created_by,
--   remarks: written_by, leads: assigned_to). Whose CRM person that is comes from the approved mapping in effect at the record's time,
--   so a later re-mapping never rewrites who made a past call. Nothing is matched by name or phone number.
-- * Sync state per connection x resource: a lease (no overlapping runs), a checkpoint that only moves after a resource was read to the
--   end (then the next run asks for updated_since = checkpoint, 10 minutes of overlap), and a resumable full pull (big accounts are read
--   over several runs, page by page). A full pull runs first and then weekly; rows it does not return are marked missing, never deleted.
-- * Only enabled connections that serve an enabled, rolled-out department are synced. Recordings are not imported.
-- * Nothing here writes to customers, leads, profiles or any other CRM table.
-- =============================================================================

create table if not exists public.crocodial_ext_leads (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_id bigint not null,
  name text, phone_number text, company text, city text, status text, source text,
  assigned_to_ext bigint, created_by_ext bigint,
  called boolean, dialer_outcome text, remark_count integer,
  next_followup_at timestamptz, last_interaction_at timestamptz,
  external_created_at timestamptz, external_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  primary key (connection_id, external_id)
);
create index if not exists crocodial_ext_leads_assignee on public.crocodial_ext_leads (connection_id, assigned_to_ext);

create table if not exists public.crocodial_ext_calls (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_id bigint not null,
  called_by_ext bigint,
  lead_ext bigint,
  phone_number text, contact_name text,
  call_type text check (call_type is null or call_type in ('incoming', 'outgoing', 'missed', 'voicemail', 'rejected', 'blocked', 'answered_elsewhere', 'unknown')),
  call_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  connected boolean,
  external_synced_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  primary key (connection_id, external_id)
);
create index if not exists crocodial_ext_calls_caller on public.crocodial_ext_calls (connection_id, called_by_ext, call_at);

create table if not exists public.crocodial_ext_followups (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_id bigint not null,
  created_by_ext bigint,
  lead_ext bigint,
  phone_number text, note text,
  scheduled_at timestamptz, done boolean, completed_at timestamptz,
  external_created_at timestamptz, external_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  primary key (connection_id, external_id)
);
create index if not exists crocodial_ext_followups_creator on public.crocodial_ext_followups (connection_id, created_by_ext, scheduled_at);

create table if not exists public.crocodial_ext_remarks (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_id bigint not null,
  written_by_ext bigint,
  lead_ext bigint,
  phone_number text, remark text,
  external_created_at timestamptz, external_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  primary key (connection_id, external_id)
);
create index if not exists crocodial_ext_remarks_writer on public.crocodial_ext_remarks (connection_id, written_by_ext, external_created_at);

create table if not exists public.crocodial_sync_state (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  resource text not null check (resource in ('leads', 'call-logs', 'followups', 'remarks')),
  checkpoint timestamptz,                -- the next run asks for rows changed since this time (null: a full pull is needed)
  last_full_at timestamptz,              -- the last full pull that was read to the end
  running_since timestamptz,             -- a lease: one run at a time (expires after 10 minutes)
  run_started_at timestamptz,            -- when the pull now in progress started (kept while it is resumed over several runs)
  run_full boolean,
  run_since timestamptz,                 -- the updated_since of the pull in progress
  next_page integer,                     -- the page to resume a pull in progress from (null: no pull in progress)
  rows_in_run integer not null default 0,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  rows_last_run integer,
  skipped_last_run integer,
  primary key (connection_id, resource)
);

create table if not exists public.crocodial_sync_runs (
  id bigserial primary key,
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  resource text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  outcome text not null check (outcome in ('DONE', 'PARTIAL', 'FAILED')),
  full_pull boolean not null default false,
  pages integer not null default 0,
  rows_stored integer not null default 0,
  rows_skipped integer not null default 0,
  error text check (error is null or length(error) <= 500)
);
create index if not exists crocodial_sync_runs_recent on public.crocodial_sync_runs (connection_id, finished_at desc);

alter table public.crocodial_connections add column if not exists last_manual_sync_at timestamptz;

do $$
declare
  t text;
begin
  foreach t in array array['crocodial_ext_leads', 'crocodial_ext_calls', 'crocodial_ext_followups', 'crocodial_ext_remarks',
                           'crocodial_sync_state', 'crocodial_sync_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- a connection that may be synced: enabled, serving at least one enabled link of a rolled-out department
create or replace function private.croc_connection_syncable(p_connection uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crocodial_connections c
                  join public.crocodial_department_links l on l.connection_id = c.id and l.enabled
                  join public.crocodial_rollout r on r.department_id = l.department_id and r.division = l.division and r.allowed
                 where c.id = p_connection and c.enabled)
$$;

-- the CRM person a Crocodial user of this account was, at that time (an approved mapping in effect then; null when none)
create or replace function private.croc_person_at(p_connection uuid, p_external bigint, p_at timestamptz)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.profile_id from public.crocodial_employee_mappings m
   where m.connection_id = p_connection and m.external_employee_id = p_external and m.status in ('APPROVED', 'REVOKED')
     and m.effective_from is not null and m.effective_from <= coalesce(p_at, now()) and (m.ended_at is null or m.ended_at > coalesce(p_at, now()))
   order by m.effective_from desc limit 1
$$;

create or replace function private.croc_ts(v text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
begin
  return nullif(btrim(coalesce(v, '')), '')::timestamptz;
exception when others then
  return null;
end $$;

create or replace function private.croc_big(v text)
returns bigint language sql immutable set search_path = '' as $$
  select case when v ~ '^[0-9]{1,18}$' then v::bigint end
$$;

-- ---------------------------------------------------------------------------
-- The server (service role): what is due, the lease, storing a page, finishing
-- ---------------------------------------------------------------------------
-- connections to sync now: syncable, not synced within p_min_interval (unless forced for one connection)
create or replace function public.croc_sync_due(p_min_interval interval default interval '15 minutes', p_connection uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'credentialRef', c.credential_ref, 'timezone', c.timezone) order by c.created_at), '[]'::jsonb)
    from public.crocodial_connections c
   where private.croc_connection_syncable(c.id)
     and (p_connection is null or c.id = p_connection)
     and (p_connection is not null
          or not exists (select 1 from public.crocodial_sync_state s where s.connection_id = c.id and s.last_run_at > now() - p_min_interval and s.next_page is null)
          or exists (select 1 from public.crocodial_sync_state s where s.connection_id = c.id and s.next_page is not null))
$$;

-- takes the lease of one resource and says what to fetch: a resumed pull, a full pull (first time / weekly), or rows changed since the checkpoint
create or replace function public.croc_sync_begin(p_connection uuid, p_resource text, p_full_every interval default interval '7 days')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.crocodial_sync_state;
begin
  if p_resource not in ('leads', 'call-logs', 'followups', 'remarks') then
    raise exception 'VALIDATION_ERROR: Unknown resource.' using errcode = '22023';
  end if;
  if not private.croc_connection_syncable(p_connection) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_SYNCABLE');
  end if;
  insert into public.crocodial_sync_state (connection_id, resource) values (p_connection, p_resource) on conflict do nothing;
  select * into s from public.crocodial_sync_state where connection_id = p_connection and resource = p_resource for update;
  if s.running_since is not null and s.running_since > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'RUNNING');
  end if;
  if s.next_page is null then
    -- a new pull: full the first time and weekly (finds rows Crocodial no longer returns), otherwise what changed since the checkpoint
    update public.crocodial_sync_state set run_started_at = now(), rows_in_run = 0, next_page = 1,
           run_full = (checkpoint is null or last_full_at is null or last_full_at < now() - p_full_every),
           run_since = case when checkpoint is null or last_full_at is null or last_full_at < now() - p_full_every then null else checkpoint end
     where connection_id = p_connection and resource = p_resource;
  end if;
  update public.crocodial_sync_state set running_since = now(), last_run_at = now()
   where connection_id = p_connection and resource = p_resource returning * into s;
  return jsonb_build_object('ok', true, 'full', s.run_full, 'since', s.run_since, 'page', s.next_page, 'startedAt', s.run_started_at);
end $$;

-- stores one page (idempotent upsert); p_next_page = the page to resume from if the run stops here (null when this was the last page)
create or replace function public.croc_sync_store(p_connection uuid, p_resource text, p_rows jsonb, p_next_page integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  v_now timestamptz := now();
begin
  if not exists (select 1 from public.crocodial_sync_state where connection_id = p_connection and resource = p_resource and running_since is not null) then
    raise exception 'CONFLICT: This sync does not hold the lease.' using errcode = 'P0001';
  end if;
  if p_resource = 'leads' then
    insert into public.crocodial_ext_leads as t (connection_id, external_id, name, phone_number, company, city, status, source, assigned_to_ext, created_by_ext,
      called, dialer_outcome, remark_count, next_followup_at, last_interaction_at, external_created_at, external_updated_at, last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), left(x ->> 'name', 200), left(x ->> 'phone', 40), left(x ->> 'company', 200), left(x ->> 'city', 120),
           left(x ->> 'status', 80), left(x ->> 'source', 80), private.croc_big(x ->> 'assignedTo'), private.croc_big(x ->> 'createdBy'),
           (x ->> 'called')::boolean, left(x ->> 'dialerOutcome', 40), (x ->> 'remarkCount')::integer, private.croc_ts(x ->> 'nextFollowupAt'),
           private.croc_ts(x ->> 'lastInteractionAt'), private.croc_ts(x ->> 'createdAt'), private.croc_ts(x ->> 'updatedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set name = excluded.name, phone_number = excluded.phone_number, company = excluded.company,
      city = excluded.city, status = excluded.status, source = excluded.source, assigned_to_ext = excluded.assigned_to_ext, created_by_ext = excluded.created_by_ext,
      called = excluded.called, dialer_outcome = excluded.dialer_outcome, remark_count = excluded.remark_count, next_followup_at = excluded.next_followup_at,
      last_interaction_at = excluded.last_interaction_at, external_created_at = excluded.external_created_at, external_updated_at = excluded.external_updated_at,
      last_seen_at = v_now, missing_since = null;
  elsif p_resource = 'call-logs' then
    insert into public.crocodial_ext_calls as t (connection_id, external_id, called_by_ext, lead_ext, phone_number, contact_name, call_type, call_at,
      duration_seconds, connected, external_synced_at, last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), private.croc_big(x ->> 'calledBy'), private.croc_big(x ->> 'lead'), left(x ->> 'phone', 40),
           left(x ->> 'contactName', 200),
           case when x ->> 'callType' in ('incoming', 'outgoing', 'missed', 'voicemail', 'rejected', 'blocked', 'answered_elsewhere') then x ->> 'callType' else 'unknown' end,
           private.croc_ts(x ->> 'callAt'), greatest(0, coalesce((x ->> 'durationSeconds')::integer, 0)), (x ->> 'connected')::boolean,
           private.croc_ts(x ->> 'syncedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set called_by_ext = excluded.called_by_ext, lead_ext = excluded.lead_ext, phone_number = excluded.phone_number,
      contact_name = excluded.contact_name, call_type = excluded.call_type, call_at = excluded.call_at, duration_seconds = excluded.duration_seconds,
      connected = excluded.connected, external_synced_at = excluded.external_synced_at, last_seen_at = v_now, missing_since = null;
  elsif p_resource = 'followups' then
    insert into public.crocodial_ext_followups as t (connection_id, external_id, created_by_ext, lead_ext, phone_number, note, scheduled_at, done, completed_at,
      external_created_at, external_updated_at, last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), private.croc_big(x ->> 'createdBy'), private.croc_big(x ->> 'lead'), left(x ->> 'phone', 40),
           left(x ->> 'note', 2000), private.croc_ts(x ->> 'scheduledAt'), (x ->> 'done')::boolean, private.croc_ts(x ->> 'completedAt'),
           private.croc_ts(x ->> 'createdAt'), private.croc_ts(x ->> 'updatedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set created_by_ext = excluded.created_by_ext, lead_ext = excluded.lead_ext, phone_number = excluded.phone_number,
      note = excluded.note, scheduled_at = excluded.scheduled_at, done = excluded.done, completed_at = excluded.completed_at,
      external_created_at = excluded.external_created_at, external_updated_at = excluded.external_updated_at, last_seen_at = v_now, missing_since = null;
  elsif p_resource = 'remarks' then
    insert into public.crocodial_ext_remarks as t (connection_id, external_id, written_by_ext, lead_ext, phone_number, remark, external_created_at, external_updated_at,
      last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), private.croc_big(x ->> 'writtenBy'), private.croc_big(x ->> 'lead'), left(x ->> 'phone', 40),
           left(x ->> 'remark', 2000), private.croc_ts(x ->> 'createdAt'), private.croc_ts(x ->> 'updatedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set written_by_ext = excluded.written_by_ext, lead_ext = excluded.lead_ext, phone_number = excluded.phone_number,
      remark = excluded.remark, external_created_at = excluded.external_created_at, external_updated_at = excluded.external_updated_at, last_seen_at = v_now, missing_since = null;
  else
    raise exception 'VALIDATION_ERROR: Unknown resource.' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  update public.crocodial_sync_state set next_page = p_next_page, rows_in_run = rows_in_run + v_n, running_since = now()
   where connection_id = p_connection and resource = p_resource;
  return v_n;
end $$;

-- ends a run of one resource. DONE (read to the end): the checkpoint moves to the pull's start minus 10 minutes of overlap; a full pull marks
-- rows it did not return as missing. PARTIAL (stopped for time): the pull resumes from next_page next run, nothing moves. FAILED: the error is
-- kept; a resumable pull keeps its place, the checkpoint does not move.
create or replace function public.croc_sync_finish(p_connection uuid, p_resource text, p_outcome text, p_pages integer, p_skipped integer, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.crocodial_sync_state;
  v_missing integer := 0;
begin
  if p_outcome not in ('DONE', 'PARTIAL', 'FAILED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = '22023';
  end if;
  select * into s from public.crocodial_sync_state where connection_id = p_connection and resource = p_resource for update;
  if s.connection_id is null then
    raise exception 'NOT_FOUND: No sync state.' using errcode = 'P0002';
  end if;
  if p_outcome = 'DONE' and s.run_full then
    if p_resource = 'leads' then
      update public.crocodial_ext_leads set missing_since = coalesce(missing_since, now()) where connection_id = p_connection and last_seen_at < s.run_started_at;
    elsif p_resource = 'call-logs' then
      update public.crocodial_ext_calls set missing_since = coalesce(missing_since, now()) where connection_id = p_connection and last_seen_at < s.run_started_at;
    elsif p_resource = 'followups' then
      update public.crocodial_ext_followups set missing_since = coalesce(missing_since, now()) where connection_id = p_connection and last_seen_at < s.run_started_at;
    else
      update public.crocodial_ext_remarks set missing_since = coalesce(missing_since, now()) where connection_id = p_connection and last_seen_at < s.run_started_at;
    end if;
    get diagnostics v_missing = row_count;
  end if;
  update public.crocodial_sync_state set
    running_since = null,
    checkpoint = case when p_outcome = 'DONE' then s.run_started_at - interval '10 minutes' else checkpoint end,
    last_full_at = case when p_outcome = 'DONE' and s.run_full then s.run_started_at else last_full_at end,
    last_ok_at = case when p_outcome = 'DONE' then now() else last_ok_at end,
    next_page = case when p_outcome = 'DONE' then null else next_page end,
    last_error = case when p_outcome = 'FAILED' then left(p_error, 500) else null end,
    rows_last_run = case when p_outcome = 'DONE' then s.rows_in_run else rows_last_run end,
    skipped_last_run = coalesce(p_skipped, 0)
   where connection_id = p_connection and resource = p_resource;
  insert into public.crocodial_sync_runs (connection_id, resource, started_at, outcome, full_pull, pages, rows_stored, rows_skipped, error)
  values (p_connection, p_resource, coalesce(s.run_started_at, now()), p_outcome, coalesce(s.run_full, false), coalesce(p_pages, 0), coalesce(s.rows_in_run, 0),
          coalesce(p_skipped, 0), case when p_outcome = 'FAILED' then left(p_error, 500) end);
  return jsonb_build_object('outcome', p_outcome, 'rows', s.rows_in_run, 'markedMissing', v_missing);
end $$;

-- ---------------------------------------------------------------------------
-- The Super Admin: sync status, unmatched records, "Sync now"
-- ---------------------------------------------------------------------------
create or replace function public.croc_sync_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.croc_require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'connectionId', c.id,
      'syncable', private.croc_connection_syncable(c.id),
      'lastManualSyncAt', c.last_manual_sync_at,
      'resources', coalesce((select jsonb_agg(jsonb_build_object('resource', s.resource, 'checkpoint', s.checkpoint, 'lastFullAt', s.last_full_at,
                    'running', s.running_since is not null and s.running_since > now() - interval '10 minutes', 'inProgress', s.next_page is not null,
                    'lastRunAt', s.last_run_at, 'lastOkAt', s.last_ok_at, 'lastError', s.last_error, 'rowsLastRun', s.rows_last_run,
                    'skippedLastRun', s.skipped_last_run) order by s.resource)
                  from public.crocodial_sync_state s where s.connection_id = c.id), '[]'::jsonb),
      'counts', jsonb_build_object(
        'leads', (select count(*) from public.crocodial_ext_leads x where x.connection_id = c.id and x.missing_since is null),
        'calls', (select count(*) from public.crocodial_ext_calls x where x.connection_id = c.id and x.missing_since is null),
        'followups', (select count(*) from public.crocodial_ext_followups x where x.connection_id = c.id and x.missing_since is null),
        'remarks', (select count(*) from public.crocodial_ext_remarks x where x.connection_id = c.id and x.missing_since is null),
        'missing', (select count(*) from public.crocodial_ext_calls x where x.connection_id = c.id and x.missing_since is not null)
                 + (select count(*) from public.crocodial_ext_leads x where x.connection_id = c.id and x.missing_since is not null)),
      -- records whose Crocodial user has no approved mapping at the record's time: kept, never counted for anyone
      'unmatched', jsonb_build_object(
        'calls', (select count(*) from public.crocodial_ext_calls x where x.connection_id = c.id and x.missing_since is null
                    and (x.called_by_ext is null or private.croc_person_at(c.id, x.called_by_ext, x.call_at) is null)),
        'followups', (select count(*) from public.crocodial_ext_followups x where x.connection_id = c.id and x.missing_since is null
                    and (x.created_by_ext is null or private.croc_person_at(c.id, x.created_by_ext, x.external_created_at) is null)),
        'leads', (select count(*) from public.crocodial_ext_leads x where x.connection_id = c.id and x.missing_since is null
                    and (x.assigned_to_ext is null or private.croc_person_at(c.id, x.assigned_to_ext, now()) is null))),
      'unmatchedByUser', coalesce((select jsonb_agg(jsonb_build_object('externalId', u.ext, 'name', e.name, 'calls', u.n) order by u.n desc)
                  from (select x.called_by_ext as ext, count(*) as n from public.crocodial_ext_calls x
                         where x.connection_id = c.id and x.missing_since is null and private.croc_person_at(c.id, x.called_by_ext, x.call_at) is null
                         group by x.called_by_ext) u
                  left join public.crocodial_ext_employees e on e.connection_id = c.id and e.external_id = u.ext), '[]'::jsonb),
      'recentRuns', coalesce((select jsonb_agg(r order by (r ->> 'finishedAt') desc) from (
                  select jsonb_build_object('resource', x.resource, 'startedAt', x.started_at, 'finishedAt', x.finished_at, 'outcome', x.outcome,
                         'fullPull', x.full_pull, 'pages', x.pages, 'rows', x.rows_stored, 'skipped', x.rows_skipped, 'error', x.error) as r
                    from public.crocodial_sync_runs x where x.connection_id = c.id order by x.finished_at desc limit 20) z), '[]'::jsonb)
    ) order by c.created_at) from public.crocodial_connections c), '[]'::jsonb);
end $$;

-- "Sync now": allowed for a syncable connection at most once every 5 minutes (Crocodial allows 60 requests a minute per token)
create or replace function public.croc_sync_request(p_connection uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
begin
  perform private.croc_require_admin();
  select * into c from public.crocodial_connections where id = p_connection for update;
  if c.id is null then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  if not private.croc_connection_syncable(c.id) then
    raise exception 'VALIDATION_ERROR: Switch the connection and its department on before syncing.' using errcode = '22023';
  end if;
  if c.last_manual_sync_at > now() - interval '5 minutes' then
    raise exception 'CONFLICT: A sync was started less than 5 minutes ago. Try again shortly.' using errcode = 'P0001';
  end if;
  update public.crocodial_connections set last_manual_sync_at = now() where id = c.id;
  perform private.write_audit('CROCODIAL_SYNC_REQUESTED', 'crocodial_connection', c.id, null, null, '{}'::jsonb);
  return jsonb_build_object('id', c.id, 'credentialRef', c.credential_ref);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['public.croc_sync_due(interval, uuid)', 'public.croc_sync_begin(uuid, text, interval)',
    'public.croc_sync_store(uuid, text, jsonb, integer)', 'public.croc_sync_finish(uuid, text, text, integer, integer, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.croc_sync_status()', 'public.croc_sync_request(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['private.croc_connection_syncable(uuid)', 'private.croc_person_at(uuid, bigint, timestamptz)',
    'private.croc_ts(text)', 'private.croc_big(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
