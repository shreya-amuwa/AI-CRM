-- =============================================================================
-- Crocodial sync without needless writes (follows 20270115000200_crocodial_sync.sql; docs/CROCODIAL_INTEGRATION.md).
--
-- The sync used to rewrite every Crocodial row it read, changed or not (last_seen_at = now()), and re-read everything weekly from
-- scheduled runs: every page read became a page of writes, which used up Supabase's disk I/O budget. Now:
-- * croc_sync_store: a top-up run writes a new row version only for rows that changed (or that come back after being marked missing); an
--   unchanged row gets no new version, index entries or dead tuple (Postgres still takes a brief row lock). Only a full read touches every
--   row it sees (that is how rows Crocodial no longer returns are found).
-- * croc_sync_begin(.., p_full_every): scheduled runs pass null, so they do a full read only the very first time; the weekly full re-read
--   happens when the Super Admin presses Sync now (7 days, the default).
-- * How often a connection is due is the server's setting (CROCODIAL_SYNC_EVERY_MINUTES, default 60), passed to croc_sync_due.
-- Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

-- takes the lease of one resource and says what to fetch: a resumed pull, a full pull (the first time; then every p_full_every, never when
-- it is null), or rows changed since the checkpoint
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
           -- the first pull is always full; the periodic full re-read only when an interval is given (Sync now: 7 days); scheduled runs
           -- pass null, so they never re-read everything on their own
           run_full = (checkpoint is null or last_full_at is null or (p_full_every is not null and last_full_at < now() - p_full_every)),
           run_since = case when checkpoint is null or last_full_at is null or (p_full_every is not null and last_full_at < now() - p_full_every) then null else checkpoint end
     where connection_id = p_connection and resource = p_resource;
  end if;
  update public.crocodial_sync_state set running_since = now(), last_run_at = now()
   where connection_id = p_connection and resource = p_resource returning * into s;
  return jsonb_build_object('ok', true, 'full', s.run_full, 'since', s.run_since, 'page', s.next_page, 'startedAt', s.run_started_at);
end $$;
revoke all on function public.croc_sync_begin(uuid, text, interval) from public, anon, authenticated;
grant execute on function public.croc_sync_begin(uuid, text, interval) to service_role;

create or replace function public.croc_sync_store(p_connection uuid, p_resource text, p_rows jsonb, p_next_page integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  v_now timestamptz := now();
  v_full boolean;
begin
  -- a full read touches every row it sees (that is how rows Crocodial no longer returns are found); a top-up writes only what changed
  select coalesce(run_full, false) into v_full from public.crocodial_sync_state where connection_id = p_connection and resource = p_resource;
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
      last_seen_at = v_now, missing_since = null
      where v_full or t.missing_since is not null
         or (t.name, t.phone_number, t.company, t.city, t.status, t.source, t.assigned_to_ext, t.created_by_ext, t.called, t.dialer_outcome, t.remark_count,
             t.next_followup_at, t.last_interaction_at, t.external_created_at, t.external_updated_at)
            is distinct from (excluded.name, excluded.phone_number, excluded.company, excluded.city, excluded.status, excluded.source, excluded.assigned_to_ext,
             excluded.created_by_ext, excluded.called, excluded.dialer_outcome, excluded.remark_count, excluded.next_followup_at, excluded.last_interaction_at,
             excluded.external_created_at, excluded.external_updated_at);
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
      connected = excluded.connected, external_synced_at = excluded.external_synced_at, last_seen_at = v_now, missing_since = null
      where v_full or t.missing_since is not null
         or (t.called_by_ext, t.lead_ext, t.phone_number, t.contact_name, t.call_type, t.call_at, t.duration_seconds, t.connected, t.external_synced_at)
            is distinct from (excluded.called_by_ext, excluded.lead_ext, excluded.phone_number, excluded.contact_name, excluded.call_type, excluded.call_at,
             excluded.duration_seconds, excluded.connected, excluded.external_synced_at);
  elsif p_resource = 'followups' then
    insert into public.crocodial_ext_followups as t (connection_id, external_id, created_by_ext, lead_ext, phone_number, note, scheduled_at, done, completed_at,
      external_created_at, external_updated_at, last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), private.croc_big(x ->> 'createdBy'), private.croc_big(x ->> 'lead'), left(x ->> 'phone', 40),
           left(x ->> 'note', 2000), private.croc_ts(x ->> 'scheduledAt'), (x ->> 'done')::boolean, private.croc_ts(x ->> 'completedAt'),
           private.croc_ts(x ->> 'createdAt'), private.croc_ts(x ->> 'updatedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set created_by_ext = excluded.created_by_ext, lead_ext = excluded.lead_ext, phone_number = excluded.phone_number,
      note = excluded.note, scheduled_at = excluded.scheduled_at, done = excluded.done, completed_at = excluded.completed_at,
      external_created_at = excluded.external_created_at, external_updated_at = excluded.external_updated_at, last_seen_at = v_now, missing_since = null
      where v_full or t.missing_since is not null
         or (t.created_by_ext, t.lead_ext, t.phone_number, t.note, t.scheduled_at, t.done, t.completed_at, t.external_created_at, t.external_updated_at)
            is distinct from (excluded.created_by_ext, excluded.lead_ext, excluded.phone_number, excluded.note, excluded.scheduled_at, excluded.done,
             excluded.completed_at, excluded.external_created_at, excluded.external_updated_at);
  elsif p_resource = 'remarks' then
    insert into public.crocodial_ext_remarks as t (connection_id, external_id, written_by_ext, lead_ext, phone_number, remark, external_created_at, external_updated_at,
      last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), private.croc_big(x ->> 'writtenBy'), private.croc_big(x ->> 'lead'), left(x ->> 'phone', 40),
           left(x ->> 'remark', 2000), private.croc_ts(x ->> 'createdAt'), private.croc_ts(x ->> 'updatedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set written_by_ext = excluded.written_by_ext, lead_ext = excluded.lead_ext, phone_number = excluded.phone_number,
      remark = excluded.remark, external_created_at = excluded.external_created_at, external_updated_at = excluded.external_updated_at, last_seen_at = v_now, missing_since = null
      where v_full or t.missing_since is not null
         or (t.written_by_ext, t.lead_ext, t.phone_number, t.remark, t.external_created_at, t.external_updated_at)
            is distinct from (excluded.written_by_ext, excluded.lead_ext, excluded.phone_number, excluded.remark, excluded.external_created_at, excluded.external_updated_at);
  else
    raise exception 'VALIDATION_ERROR: Unknown resource.' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  update public.crocodial_sync_state set next_page = p_next_page, rows_in_run = rows_in_run + v_n, running_since = now()
   where connection_id = p_connection and resource = p_resource;
  return v_n;
end $$;
revoke all on function public.croc_sync_store(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.croc_sync_store(uuid, text, jsonb, integer) to service_role;
