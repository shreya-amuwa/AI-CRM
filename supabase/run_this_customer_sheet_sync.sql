-- =============================================================================
-- Google Sheet sync for "Import existing customers" (docs/CUSTOMER_SHEET_SYNC.md).
--
-- WHY: the Support team keeps one shared Google Sheet of its customers (the one-sheet import template) and had to download it and upload it
-- to the CRM again after every change. Now a person who may import customers connects the sheet once: the CRM gives them an Apps Script
-- with a secret sync key; "CRM Sync > Sync now" in the sheet sends the rows that changed, and the CRM saves them exactly as the Excel
-- upload would, with that person's permissions. The manual upload stays.
--
-- WHAT THIS ADDS (additive; no existing table, function or row is changed):
--   * customer_sheet_connections: one ACTIVE connection per person (key kept only as a SHA-256 hash, plus its last 4 characters to recognise it).
--   * customer_sheet_sync_runs: every sync (who, when, rows received, added / updated / rejected / held as duplicates).
--   * sheet_sync_connection_create / _get / _revoke: the person's own connection (authenticated; same people as the Excel import).
--   * sheet_sync_apply(key_hash, data): SERVICE ROLE ONLY (the API calls it after checking the key format). It runs import_customer_data AS the
--     person who connected the sheet (their permissions, team and department, nothing more), customer by customer, so one wrong row never
--     blocks the others, and returns a result for every sheet row.
--   * sheet_sync_record_login: SERVICE ROLE ONLY; records a client login created for a synced customer, as that person.
-- DUPLICATES (stricter than the Excel upload, which looks inside the department only):
--   * a mobile number that is already a customer ANYWHERE in the CRM is never added again. When the person may update that customer, the
--     sheet updates its services and usage only (name, e-mail and who handles them stay as they are in the CRM); otherwise the row is held.
--   * a NEW mobile whose e-mail already belongs to another customer (anywhere) is held as a possible duplicate for a person to check.
--   * Client Password is never accepted from a sheet (the API drops it): clients choose their own password from the e-mailed link.
-- Run after 20270215000100_global_search.sql. Safe to run twice.
-- =============================================================================

create table if not exists public.customer_sheet_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_hint text not null check (length(key_hint) between 2 and 8),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  last_sync_at timestamptz,
  sync_count integer not null default 0,
  last_result jsonb
);
create unique index if not exists customer_sheet_connections_one_active on public.customer_sheet_connections (owner_id) where status = 'ACTIVE';
alter table public.customer_sheet_connections enable row level security;
revoke all on table public.customer_sheet_connections from public, anon, authenticated;

create table if not exists public.customer_sheet_sync_runs (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.customer_sheet_connections (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  rows_received integer not null default 0,
  added integer not null default 0,
  updated integer not null default 0,
  saved integer not null default 0,
  rejected integer not null default 0,
  duplicates integer not null default 0,
  outcome text not null check (outcome in ('OK', 'PARTIAL', 'FAILED', 'EMPTY'))
);
create index if not exists customer_sheet_sync_runs_conn_idx on public.customer_sheet_sync_runs (connection_id, started_at desc);
alter table public.customer_sheet_sync_runs enable row level security;
revoke all on table public.customer_sheet_sync_runs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may connect a sheet: exactly who may use the Excel import (import_customer_data)
-- ---------------------------------------------------------------------------
create or replace function private.sheet_sync_may_connect()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_id() is not null and private.may_work_in_support()
     and private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER')
$$;
revoke all on function private.sheet_sync_may_connect() from public, anon, authenticated;

create or replace function private.sheet_sync_connection_json(c public.customer_sheet_connections)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when c.id is null then null else jsonb_build_object(
    'id', c.id, 'keyHint', c.key_hint, 'status', c.status, 'createdAt', c.created_at, 'lastSyncAt', c.last_sync_at,
    'syncCount', c.sync_count, 'lastResult', c.last_result,
    'runs', coalesce((select jsonb_agg(jsonb_build_object('at', r.started_at, 'rows', r.rows_received, 'added', r.added, 'updated', r.updated,
                        'saved', r.saved, 'rejected', r.rejected, 'duplicates', r.duplicates, 'outcome', r.outcome) order by r.started_at desc)
                       from (select * from public.customer_sheet_sync_runs x where x.connection_id = c.id order by x.started_at desc limit 10) r), '[]'::jsonb)) end
$$;
revoke all on function private.sheet_sync_connection_json(public.customer_sheet_connections) from public, anon, authenticated;

-- A new connection (or a new key: the old one stops working at once). The API makes the key and sends only its hash.
create or replace function public.sheet_sync_connection_create(p_key_hash text, p_key_hint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customer_sheet_connections;
begin
  if not private.sheet_sync_may_connect() then
    raise exception 'FORBIDDEN: Only the Support team can connect a customer sheet.' using errcode = '42501';
  end if;
  if coalesce(p_key_hash, '') !~ '^[0-9a-f]{64}$' or length(coalesce(p_key_hint, '')) not between 2 and 8 then
    raise exception 'VALIDATION_ERROR: The sync key could not be made. Try again.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = private.my_id();
  update public.customer_sheet_connections set status = 'REVOKED', revoked_at = now(), revoked_by = me.id
   where owner_id = me.id and status = 'ACTIVE';
  insert into public.customer_sheet_connections (owner_id, department_id, key_hash, key_hint)
  values (me.id, private.scoped_department(me.id, me.department_id), p_key_hash, p_key_hint)
  returning * into c;
  perform private.write_audit('CUSTOMER_SHEET_CONNECTED', 'customer_sheet_connection', c.id, c.department_id, me.team_id, jsonb_build_object('keyHint', c.key_hint));
  return private.sheet_sync_connection_json(c);
end $$;
revoke all on function public.sheet_sync_connection_create(text, text) from public, anon;
grant execute on function public.sheet_sync_connection_create(text, text) to authenticated;

create or replace function public.sheet_sync_connection_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customer_sheet_connections;
begin
  if not private.sheet_sync_may_connect() then
    raise exception 'FORBIDDEN: Only the Support team can connect a customer sheet.' using errcode = '42501';
  end if;
  select * into c from public.customer_sheet_connections where owner_id = private.my_id() and status = 'ACTIVE';
  return private.sheet_sync_connection_json(c);
end $$;
revoke all on function public.sheet_sync_connection_get() from public, anon;
grant execute on function public.sheet_sync_connection_get() to authenticated;

create or replace function public.sheet_sync_connection_revoke()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customer_sheet_connections;
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  update public.customer_sheet_connections set status = 'REVOKED', revoked_at = now(), revoked_by = private.my_id()
   where owner_id = private.my_id() and status = 'ACTIVE' returning * into c;
  if c.id is not null then
    perform private.write_audit('CUSTOMER_SHEET_DISCONNECTED', 'customer_sheet_connection', c.id, c.department_id, null, jsonb_build_object('keyHint', c.key_hint));
  end if;
  return jsonb_build_object('revoked', c.id is not null);
end $$;
revoke all on function public.sheet_sync_connection_revoke() from public, anon;
grant execute on function public.sheet_sync_connection_revoke() to authenticated;

-- ---------------------------------------------------------------------------
-- Acting as the person who connected the sheet. For THIS transaction only (set_config(..., true)): the database's own checks
-- (private.my_id(), the active department, may_update_support_customer ...) then apply exactly as if that person had uploaded the file.
-- ---------------------------------------------------------------------------
create or replace function private.sheet_sync_act_as(p_key_hash text, p_lock boolean)
returns public.customer_sheet_connections language plpgsql security definer set search_path = '' as $$
declare
  c public.customer_sheet_connections;
  p public.profiles;
begin
  if p_lock then
    begin
      select * into c from public.customer_sheet_connections where key_hash = p_key_hash and status = 'ACTIVE' for update nowait;
    exception when lock_not_available then
      raise exception 'CONFLICT: Another sync of this sheet is still running. Wait a moment, then click Sync now again.' using errcode = 'P0001';
    end;
  else
    select * into c from public.customer_sheet_connections where key_hash = p_key_hash and status = 'ACTIVE';
  end if;
  if c.id is null then
    raise exception 'FORBIDDEN: This sync key is not valid any more (it was replaced or disconnected). Copy the new script from the CRM: Import Customers > Google Sheet sync.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = c.owner_id;
  if p.id is null or p.status <> 'ACTIVE' then
    raise exception 'FORBIDDEN: % who connected this sheet can no longer sign in to the CRM. Someone else must connect it again.', coalesce(p.full_name, 'The person') using errcode = '42501';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p.id, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', case when c.department_id is null then '{}' else jsonb_build_object('x-active-department', c.department_id)::text end, true);
  if not private.sheet_sync_may_connect() then
    raise exception 'FORBIDDEN: % can no longer import customers, so this sheet cannot be synced. Someone in the Support team must connect it again.', p.full_name using errcode = '42501';
  end if;
  return c;
end $$;
revoke all on function private.sheet_sync_act_as(text, boolean) from public, anon, authenticated;

-- The rows of p_data, without the excluded sheet rows and mobile numbers.
create or replace function private.sheet_sync_filter(p_data jsonb, p_rows jsonb, p_mobiles jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(e.key, (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(e.value) x
                                            where not (p_rows ? coalesce(x ->> 'row', ''))
                                              and not (p_mobiles ? coalesce(right(regexp_replace(coalesce(x ->> 'mobile', ''), '\D', '', 'g'), 10), '')))),
                  '{}'::jsonb)
    from jsonb_each(p_data) e where jsonb_typeof(e.value) = 'array'
$$;
revoke all on function private.sheet_sync_filter(jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function private.sheet_sync_total(p_data jsonb)
returns integer language sql immutable set search_path = '' as $$
  select coalesce(sum(jsonb_array_length(e.value)), 0)::integer from jsonb_each(p_data) e where jsonb_typeof(e.value) = 'array'
$$;
revoke all on function private.sheet_sync_total(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The sync itself (service role only). p_data is what the import parser makes of the sheet (customers, services, whatsapp, campaigns,
-- aiCalling, rcsVoice, monthly), every record carrying its sheet "row". Returns { results: [{row, status, message}], summary, newLogins }.
-- status: ADDED (new customer), UPDATED (customer already in the CRM: services / usage updated), SAVED (a service / usage row),
--         DUPLICATE (held: a person must check), ERROR (the problem to fix in the sheet), SKIPPED (not saved because of another row).
-- ---------------------------------------------------------------------------
create or replace function public.sheet_sync_apply(p_key_hash text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn public.customer_sheet_connections;
  r jsonb;
  c public.customers;
  v_row text;
  v_mobile text;
  v_email text;
  v_status jsonb := '{}'::jsonb;        -- sheet row -> {status, message}, the worst one wins
  v_excl_rows jsonb := '{}'::jsonb;     -- sheet rows left out of the save
  v_excl_mobiles jsonb := '{}'::jsonb;  -- new customers left out (all their rows)
  v_cause jsonb := '{}'::jsonb;         -- left-out new customer's mobile -> the row with the problem (the other rows point at it)
  v_cause_row text;
  v_known jsonb := '{}'::jsonb;         -- mobiles already in the CRM (usage-only updates)
  v_customers jsonb := '[]'::jsonb;
  v_data jsonb;
  v_res jsonb;
  e jsonb;
  v_try integer := 0;
  v_committed boolean := false;
  v_logins jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_added integer := 0;
  v_updated integer := 0;
  v_saved integer := 0;
  v_rejected integer := 0;
  v_dups integer := 0;
  v_received integer;
  v_outcome text;
  v_key text;
begin
  if coalesce(p_key_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'FORBIDDEN: This sync key is not valid.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'VALIDATION_ERROR: The sheet could not be read.' using errcode = 'P0001';
  end if;
  conn := private.sheet_sync_act_as(p_key_hash, true);
  v_received := private.sheet_sync_total(p_data);

  -- 1. Duplicates, before anything is saved (the person's permissions apply: private.may_update_support_customer)
  for r in select x from jsonb_array_elements(coalesce(p_data -> 'customers', '[]'::jsonb)) x loop
    v_row := coalesce(r ->> 'row', '');
    v_mobile := private.mobile10(r ->> 'mobile');
    if v_mobile is null then
      v_customers := v_customers || r;   -- the import says what is wrong with it
      continue;
    end if;
    select * into c from public.customers x where private.mobile10(x.phone) = v_mobile
     order by (x.lifecycle_stage = 'CUSTOMER') desc, x.created_at limit 1;
    if c.id is not null then
      if private.may_update_support_customer(c.id) then
        -- already a customer of this person / team: the sheet updates services and usage only (the CRM's details stay)
        v_known := jsonb_set(v_known, array[v_mobile], to_jsonb(c.id::text));
        v_status := jsonb_set(v_status, array[v_row], jsonb_build_object('status', 'UPDATED',
          'message', format('Already in the CRM as %s (%s). Services and usage are updated; the details in the CRM are kept.', coalesce(c.company, c.name), c.customer_code)));
      else
        v_excl_mobiles := jsonb_set(v_excl_mobiles, array[v_mobile], 'true'::jsonb);
        v_cause := jsonb_set(v_cause, array[v_mobile], to_jsonb(v_row));
        v_status := jsonb_set(v_status, array[v_row], jsonb_build_object('status', 'DUPLICATE',
          'message', format('This mobile number is already a customer in the CRM (%s) looked after by another person or team. Not added again.', c.customer_code)));
      end if;
      continue;
    end if;
    v_email := lower(nullif(btrim(coalesce(r ->> 'email', '')), ''));
    if v_email is not null then
      select * into c from public.customers x where lower(x.email) = v_email order by x.created_at limit 1;
      if c.id is not null then
        v_excl_mobiles := jsonb_set(v_excl_mobiles, array[v_mobile], 'true'::jsonb);
        v_cause := jsonb_set(v_cause, array[v_mobile], to_jsonb(v_row));
        v_status := jsonb_set(v_status, array[v_row], jsonb_build_object('status', 'DUPLICATE',
          'message', format('Possible duplicate: customer %s already has the e-mail %s with another mobile number. Check it; if it is a different customer, change the e-mail.', c.customer_code, v_email)));
        continue;
      end if;
    end if;
    v_customers := v_customers || r;
  end loop;
  v_data := jsonb_set(p_data, '{customers}', v_customers);

  -- 2. Save. A row with a problem is left out (a NEW customer with all its rows), the rest is saved; the import is all-or-nothing, so
  --    check first, leave out what failed, and save the rest (a few rounds at most: leaving rows out can only remove problems).
  loop
    v_try := v_try + 1;
    v_data := private.sheet_sync_filter(v_data, v_excl_rows, v_excl_mobiles);
    if private.sheet_sync_total(v_data) = 0 then
      v_committed := true;  -- nothing (left) to save: what was decided above stands
      v_res := null;
      exit;
    end if;
    v_res := public.import_customer_data(v_data, true);  -- saves only when no row has a problem
    if (v_res ->> 'committed')::boolean then
      v_committed := true;
      exit;
    end if;
    exit when v_try >= 5;
    for e in select x from jsonb_array_elements(coalesce(v_res -> 'errors', '[]'::jsonb)) x loop
      v_key := coalesce(e ->> 'row', '');
      v_status := jsonb_set(v_status, array[v_key], jsonb_build_object('status', 'ERROR', 'message', e ->> 'message'));
      v_excl_rows := jsonb_set(v_excl_rows, array[v_key], 'true'::jsonb);
      -- the mobile of that row: when it is a NEW customer, none of its rows can be saved
      select private.mobile10(x ->> 'mobile') into v_mobile
        from jsonb_each(v_data) e3, jsonb_array_elements(e3.value) x where coalesce(x ->> 'row', '') = v_key limit 1;
      if v_mobile is not null and not (v_known ? v_mobile) then
        v_excl_mobiles := jsonb_set(v_excl_mobiles, array[v_mobile], 'true'::jsonb);
        if not (v_cause ? v_mobile) then
          v_cause := jsonb_set(v_cause, array[v_mobile], to_jsonb(v_key));
        end if;
      end if;
    end loop;
  end loop;
  if v_committed and v_res is not null then
    v_summary := v_res -> 'summary';
    v_logins := coalesce(v_res -> 'newLogins', '[]'::jsonb);
  end if;

  -- 3. A result for every sheet row
  for r in select x from jsonb_each(p_data) e4, jsonb_array_elements(case when jsonb_typeof(e4.value) = 'array' then e4.value else '[]'::jsonb end) x loop
    v_row := coalesce(r ->> 'row', '');
    v_mobile := private.mobile10(r ->> 'mobile');
    v_cause_row := case when v_mobile is not null then v_cause ->> v_mobile end;
    -- a row keeps its own problem; the other rows of a new customer that was left out point at the row that caused it
    continue when coalesce(v_status -> v_row ->> 'status', '') in ('ERROR', 'DUPLICATE') and (v_cause_row is null or v_cause_row = v_row);
    if v_mobile is not null and v_excl_mobiles ? v_mobile then
      v_status := jsonb_set(v_status, array[v_row], jsonb_build_object('status', 'SKIPPED',
        'message', format('Not saved: this customer was not added because of row %s. Fix that row, then sync again.', coalesce(v_cause_row, '?'))));
    elsif not v_committed then
      v_status := jsonb_set(v_status, array[v_row], jsonb_build_object('status', 'SKIPPED', 'message', 'Not saved: fix the rows marked with a problem, then sync again.'));
    elsif v_status ? v_row then
      null;  -- UPDATED (already in the CRM) stays
    elsif (select bool_or(coalesce(x ->> 'row', '') = v_row) from jsonb_array_elements(v_customers) x) then
      v_status := jsonb_set(v_status, array[v_row], jsonb_build_object('status', 'ADDED', 'message', 'Added to the CRM.'));
    else
      v_status := jsonb_set(v_status, array[v_row], jsonb_build_object('status', 'SAVED', 'message', 'Saved.'));
    end if;
  end loop;
  select count(*) filter (where value ->> 'status' = 'ADDED'), count(*) filter (where value ->> 'status' = 'UPDATED'),
         count(*) filter (where value ->> 'status' = 'SAVED'), count(*) filter (where value ->> 'status' in ('ERROR', 'SKIPPED')),
         count(*) filter (where value ->> 'status' = 'DUPLICATE')
    into v_added, v_updated, v_saved, v_rejected, v_dups from jsonb_each(v_status);

  v_outcome := case when v_received = 0 then 'EMPTY' when v_rejected + v_dups = 0 then 'OK' when v_added + v_updated + v_saved > 0 then 'PARTIAL' else 'FAILED' end;
  insert into public.customer_sheet_sync_runs (connection_id, owner_id, rows_received, added, updated, saved, rejected, duplicates, outcome)
  values (conn.id, conn.owner_id, (select count(*) from jsonb_object_keys(v_status))::integer, v_added, v_updated, v_saved, v_rejected, v_dups, v_outcome);
  update public.customer_sheet_connections
     set last_sync_at = now(), sync_count = sync_count + 1,
         last_result = jsonb_build_object('added', v_added, 'updated', v_updated, 'saved', v_saved, 'rejected', v_rejected, 'duplicates', v_dups, 'outcome', v_outcome)
   where id = conn.id;
  return jsonb_build_object(
    'results', coalesce((select jsonb_agg(jsonb_build_object('row', key::integer, 'status', value ->> 'status', 'message', value ->> 'message') order by key::integer)
                           from jsonb_each(v_status) where key ~ '^\d+$'), '[]'::jsonb),
    'summary', jsonb_build_object('added', v_added, 'updated', v_updated, 'saved', v_saved, 'rejected', v_rejected, 'duplicates', v_dups, 'outcome', v_outcome)
               || coalesce(v_summary, '{}'::jsonb) - 'added' - 'updated',
    'ownerId', conn.owner_id,
    'newLogins', v_logins);
end $$;
revoke all on function public.sheet_sync_apply(text, jsonb) from public, anon, authenticated;
grant execute on function public.sheet_sync_apply(text, jsonb) to service_role;

-- A client login the API created for a customer the sheet added: recorded as the person who connected the sheet.
create or replace function public.sheet_sync_record_login(p_key_hash text, p_customer uuid, p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.sheet_sync_act_as(p_key_hash, false);
  perform public.record_imported_client_login(p_customer, p_user_id, p_email);
end $$;
revoke all on function public.sheet_sync_record_login(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sheet_sync_record_login(text, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
