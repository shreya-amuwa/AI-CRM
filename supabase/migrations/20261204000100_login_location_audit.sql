-- Where a sign-in came from: approximate location on the audit trail, visible to the Super Admin only.
--
-- WHAT EXISTED: public.audit_logs (append-only; outcome, actor role / name snapshot, request id, address, dedupe key), written by
-- triggers, SECURITY DEFINER functions and, for what the database cannot see, public.record_server_event (service role only, called by
-- the Hono API). Sign-ins reach the API as the SESSION_STARTED event; failed password checks are LOGIN_FAILED (Auth hook).
--
-- WHAT THIS ADDS (additive: nothing is dropped, no history is rewritten)
--   1. public.audit_log_locations: one optional row per audit event, written with the event by record_server_event. Country, region,
--      city, approximate coordinates (rounded to 2 decimals, about 1 km), where the place came from (source) and how precise it is.
--      Row-level security lets only the Super Admin read it. Nobody can change or delete a row (the API roles have no such privilege,
--      and a trigger refuses it, as for audit_logs).
--   2. The caller address (audit_logs.ip) is no longer readable by the API roles directly (column privilege); the viewer reads it
--      through a function that returns it to the Super Admin only. Department Heads and Team Leads still see every event of their
--      scope, without the address or the place.
--   3. record_server_event takes the optional location (same call as before when it is left out).
--   4. audit_log_search returns "location" and "ip" (Super Admin only) and searches the place as well (city, region, country).
--
-- Run after 20261203000100_sales_field_visits.sql. Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. The place of an event
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log_locations (
  -- no foreign key: one would stop TRUNCATE of audit_logs from reaching its own guard; the purge trigger below keeps the two together
  audit_id   bigint primary key,
  country    text check (length(country) <= 100),
  region     text check (length(region) <= 100),
  city       text check (length(city) <= 100),
  latitude   numeric(7, 2) check (latitude between -90 and 90),
  longitude  numeric(8, 2) check (longitude between -180 and 180),
  -- where the place came from: the hosting platform's own IP lookup, an IP lookup service, or a place the person agreed to share
  source     text not null check (source in ('PLATFORM_IP', 'IP_PROVIDER', 'BROWSER_PERMISSION')),
  -- how precise it is: an address lookup is at best the city (it is the network's location, not the person's)
  accuracy   text not null check (accuracy in ('COUNTRY', 'REGION', 'CITY', 'DEVICE')),
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create index if not exists audit_log_locations_place_idx on public.audit_log_locations (lower(coalesce(city, '')), lower(coalesce(country, '')));

alter table public.audit_log_locations enable row level security;
revoke all on public.audit_log_locations from public, anon, authenticated, service_role;
grant select on public.audit_log_locations to authenticated;
drop policy if exists audit_log_locations_super_admin on public.audit_log_locations;
create policy audit_log_locations_super_admin on public.audit_log_locations for select to authenticated
  using ((select private.is_super_admin()));

create or replace function private.tg_audit_log_locations_protect()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('amuwa.audit_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'FORBIDDEN: Audit records cannot be changed.' using errcode = '42501';
end $$;
revoke all on function private.tg_audit_log_locations_protect() from public, anon, authenticated;
drop trigger if exists audit_log_locations_protect on public.audit_log_locations;
create trigger audit_log_locations_protect before update or delete on public.audit_log_locations
  for each row execute function private.tg_audit_log_locations_protect();

-- a deliberate purge of audit rows (amuwa.audit_purge) takes their places with them
create or replace function private.tg_audit_logs_purge_locations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.audit_log_locations where audit_id = old.id;
  return old;
end $$;
revoke all on function private.tg_audit_logs_purge_locations() from public, anon, authenticated;
drop trigger if exists audit_logs_purge_locations on public.audit_logs;
create trigger audit_logs_purge_locations after delete on public.audit_logs
  for each row execute function private.tg_audit_logs_purge_locations();

-- ---------------------------------------------------------------------------
-- 2. The caller address: Super Admin only, through a function
-- ---------------------------------------------------------------------------
create or replace function private.audit_ip(p_id bigint)
returns text language sql stable security definer set search_path = '' as $$
  select a.ip from public.audit_logs a where a.id = p_id and private.is_super_admin()
$$;
revoke all on function private.audit_ip(bigint) from public, anon;
grant execute on function private.audit_ip(bigint) to authenticated;

do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
    from pg_attribute
   where attrelid = 'public.audit_logs'::regclass and attnum > 0 and not attisdropped and attname <> 'ip';
  execute 'revoke select on public.audit_logs from authenticated';
  execute format('grant select (%s) on public.audit_logs to authenticated', v_cols);
end $$;

-- ---------------------------------------------------------------------------
-- 3. record_server_event: the optional place travels with the event
-- ---------------------------------------------------------------------------
drop function if exists public.record_server_event(text, text, uuid, uuid, text, text, text, text, jsonb);
create or replace function public.record_server_event(
  p_action text, p_entity_type text, p_entity_id uuid, p_actor uuid, p_outcome text,
  p_request_id text, p_ip text, p_dedupe_key text, p_metadata jsonb default '{}'::jsonb, p_location jsonb default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_id bigint;
  v_lat numeric;
  v_lon numeric;
begin
  if p_action is null or p_action !~ '^[A-Z][A-Z0-9_]{1,63}$' or p_entity_type is null or p_entity_type !~ '^[a-z_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: Unknown event.' using errcode = 'P0001';
  end if;
  if p_outcome not in ('SUCCESS', 'FAILURE', 'DENIED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  if p_location is not null and (jsonb_typeof(p_location) <> 'object'
       or coalesce(p_location ->> 'source', '') not in ('PLATFORM_IP', 'IP_PROVIDER', 'BROWSER_PERMISSION')
       or coalesce(p_location ->> 'accuracy', '') not in ('COUNTRY', 'REGION', 'CITY', 'DEVICE')) then
    raise exception 'VALIDATION_ERROR: Unknown location.' using errcode = 'P0001';
  end if;
  if length(v_meta::text) > 4000 then
    v_meta := jsonb_build_object('truncated', true);
  end if;
  if p_actor is not null then
    select * into p from public.profiles where id = p_actor;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, outcome, request_id, ip, dedupe_key, metadata)
  values (p.id, p_action, p_entity_type, p_entity_id, p.department_id, p.team_id, p_outcome,
          nullif(left(p_request_id, 128), ''), nullif(left(p_ip, 64), ''), nullif(left(p_dedupe_key, 240), ''), v_meta)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;

  if p_location is not null then
    -- coordinates only when both are given and real; never invented here
    begin
      v_lat := round((p_location ->> 'latitude')::numeric, 2);
      v_lon := round((p_location ->> 'longitude')::numeric, 2);
    exception when others then
      v_lat := null;
      v_lon := null;
    end;
    if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 then
      v_lat := null;
      v_lon := null;
    end if;
    insert into public.audit_log_locations (audit_id, country, region, city, latitude, longitude, source, accuracy)
    values (v_id, nullif(left(btrim(coalesce(p_location ->> 'country', '')), 100), ''), nullif(left(btrim(coalesce(p_location ->> 'region', '')), 100), ''),
            nullif(left(btrim(coalesce(p_location ->> 'city', '')), 100), ''), v_lat, v_lon, p_location ->> 'source', p_location ->> 'accuracy');
  end if;
  return true;
end $$;
revoke all on function public.record_server_event(text, text, uuid, uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_server_event(text, text, uuid, uuid, text, text, text, text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The viewer
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_search(
  p_search text default null, p_action text default null, p_outcome text default null, p_entity_type text default null,
  p_from date default null, p_to date default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_total bigint;
  v_items jsonb;
begin
  if private.my_role() is null or private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') then
    raise exception 'FORBIDDEN: Only managers can read the audit log.' using errcode = '42501';
  end if;
  if p_outcome is not null and p_outcome not in ('SUCCESS', 'FAILURE', 'DENIED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;

  -- audit_log_locations is visible to the Super Admin only (row-level security): for everyone else the join finds nothing
  select count(*) into v_total from public.audit_logs a
    left join public.audit_log_locations l on l.audit_id = a.id
   where (p_action is null or a.action = p_action)
     and (p_outcome is null or a.outcome = p_outcome)
     and (p_entity_type is null or a.entity_type = p_entity_type)
     and (p_from is null or a.created_at >= p_from::timestamptz)
     and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
     and (v_term is null or lower(a.action) like '%' || v_term || '%' or lower(coalesce(a.actor_label, '')) like '%' || v_term || '%'
          or lower(coalesce(a.request_id, '')) like '%' || v_term || '%' or a.entity_id::text = v_term
          or lower(concat_ws(' ', l.city, l.region, l.country)) like '%' || v_term || '%');

  select coalesce(jsonb_agg(x.j order by x.created_at desc, x.id desc), '[]'::jsonb) into v_items from (
    select a.id, a.created_at, jsonb_build_object(
             'id', a.id, 'at', a.created_at, 'action', a.action, 'entityType', a.entity_type, 'entityId', a.entity_id,
             'outcome', a.outcome, 'actorId', a.actor_id, 'actor', coalesce(a.actor_label, pr.full_name), 'actorRole', a.actor_role,
             'departmentId', a.department_id, 'department', d.name, 'requestId', a.request_id,
             'ip', private.audit_ip(a.id),
             'location', case when l.audit_id is null then null else jsonb_build_object(
                'country', l.country, 'region', l.region, 'city', l.city, 'latitude', l.latitude, 'longitude', l.longitude,
                'source', l.source, 'accuracy', l.accuracy) end,
             'metadata', a.metadata) as j
      from public.audit_logs a
      left join public.audit_log_locations l on l.audit_id = a.id
      left join public.profiles pr on pr.id = a.actor_id
      left join public.departments d on d.id = a.department_id
     where (p_action is null or a.action = p_action)
       and (p_outcome is null or a.outcome = p_outcome)
       and (p_entity_type is null or a.entity_type = p_entity_type)
       and (p_from is null or a.created_at >= p_from::timestamptz)
       and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
       and (v_term is null or lower(a.action) like '%' || v_term || '%' or lower(coalesce(a.actor_label, '')) like '%' || v_term || '%'
            or lower(coalesce(a.request_id, '')) like '%' || v_term || '%' or a.entity_id::text = v_term
            or lower(concat_ws(' ', l.city, l.region, l.country)) like '%' || v_term || '%')
     order by a.created_at desc, a.id desc
     limit v_size offset (v_page - 1) * v_size) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.audit_log_search(text, text, text, text, date, date, integer, integer) from public, anon;
grant execute on function public.audit_log_search(text, text, text, text, date, date, integer, integer) to authenticated;

notify pgrst, 'reload schema';
