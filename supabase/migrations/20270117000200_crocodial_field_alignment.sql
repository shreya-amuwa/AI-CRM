-- =============================================================================
-- Crocodial field alignment (docs/CROCODIAL_INTEGRATION.md "Field mapping"). Run after 20270116000400_crocodial_leads.sql.
-- Additive and safe to run twice. Nothing is written, no table or column changes, no stored Crocodial record is touched.
--
-- ONE place computes a person's Crocodial call figures and CRM demo figures; every Sales screen reads them from here:
--   private.croc_window(profile, from, to)        the period in the person's Crocodial account time zone (at most 93 days)
--   private.croc_person_calls(profile, start, end) the calls attributed to the person: called_by = their Crocodial user, under the approved
--                                                  mapping in effect at call_at (never by name), rows Crocodial still returns (not missing)
--   private.croc_call_summary(profile, start, end)  the call figures (below)
--   private.croc_demo_summary(profile, start, end)  the CRM demo figures (ba_demos: Crocodial has no demo data)
--   private.croc_person_state(profile)              connected (approved mapping, switched on), synced, stale, account time zone
-- public.croc_activity and public.croc_team_activity are re-defined on top of them, with the SAME answers as before plus two figures; the
-- Sales head's role-wise sections (20270117000300) call the same helpers.
--
-- Call figures (Crocodial call-logs fields: called_by.id, lead.id, phone_number, contact_name, call_type, call_at, duration_seconds, connected):
--   made           call_type = 'outgoing'
--   connected      outgoing and connected = true
--   notConnected   outgoing and connected = false   (an outgoing call whose "connected" Crocodial left empty is in neither)
--   connectRate    connected / made (null when nothing was made)
--   talkSeconds    sum of duration_seconds of connected outgoing calls
--   incoming       call_type = 'incoming';  missed: call_type = 'missed'
--   uniqueLeads    distinct Crocodial leads (lead.id) of the outgoing calls
--   uniqueNumbers  distinct phone numbers of the outgoing calls (digits only, the last 10, so +91 98... and 98... are one number)
-- Team totals: uniqueLeads / uniqueNumbers are counted once across the people listed (before: summed per person, so a lead two people
-- called counted twice).
-- =============================================================================

-- the number as one key: digits only, the last 10 (Indian mobile numbers with or without +91 / 0)
create or replace function private.croc_number_key(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case when length(d) >= 10 then right(d, 10) when length(d) >= 4 then d end
    from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) s
$$;

-- the masked number shown on screens (last 4 digits), as croc_activity always showed it
create or replace function private.croc_mask(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 4
              then 'XXXXXX' || right(regexp_replace(p_phone, '\D', '', 'g'), 4) end
$$;

-- connected now (an approved mapping whose connection, department link and rollout are switched on), synced, stale, time zone
create or replace function private.croc_person_state(p_profile uuid, out o_department uuid, out o_division text, out o_tz text,
  out o_enabled boolean, out o_available boolean, out o_stale boolean, out o_last_ok timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_never boolean;
begin
  select m.department_id, m.division, coalesce(c.timezone, 'Asia/Kolkata')
    into o_department, o_division, o_tz
    from public.crocodial_employee_mappings m
    join public.crocodial_connections c on c.id = m.connection_id and c.enabled
    join public.crocodial_department_links l on l.connection_id = m.connection_id and l.department_id = m.department_id and l.division = m.division and l.enabled
    join public.crocodial_rollout ro on ro.department_id = m.department_id and ro.division = m.division and ro.allowed
   where m.profile_id = p_profile and m.status in ('APPROVED', 'REVOKED') and m.effective_from is not null
   order by (m.status = 'APPROVED') desc, m.effective_from desc
   limit 1;
  o_enabled := o_department is not null;
  o_tz := coalesce(o_tz, 'Asia/Kolkata');
  if not o_enabled then
    o_available := false;
    o_stale := true;
    return;
  end if;
  -- freshness: the oldest complete read of the person's connections (all four kinds of data)
  select min(s.last_ok_at), bool_or(s.last_ok_at is null) or count(s.*) < 4 * count(distinct m.connection_id)
    into o_last_ok, v_never
    from public.crocodial_employee_mappings m
    left join public.crocodial_sync_state s on s.connection_id = m.connection_id
   where m.profile_id = p_profile and m.status in ('APPROVED', 'REVOKED');
  o_available := not coalesce(v_never, true) and o_last_ok is not null;
  o_stale := o_last_ok is null or o_last_ok < now() - interval '24 hours';
end $$;

-- the period: days in the account's time zone, both ends included, at most 93 days (default the last 7)
create or replace function private.croc_window(p_tz text, p_from date, p_to date, out o_from date, out o_to date, out o_start timestamptz, out o_end timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  o_to := coalesce(p_to, (now() at time zone p_tz)::date);
  o_from := coalesce(p_from, o_to - 6);
  if o_from > o_to then
    raise exception 'VALIDATION_ERROR: The start date is after the end date.' using errcode = '22023';
  end if;
  if o_to - o_from > 92 then
    raise exception 'VALIDATION_ERROR: Choose at most 93 days.' using errcode = '22023';
  end if;
  o_start := o_from::timestamp at time zone p_tz;
  o_end := (o_to + 1)::timestamp at time zone p_tz;
end $$;

-- the calls attributed to the person in [start, end)
create or replace function private.croc_person_calls(p_profile uuid, p_start timestamptz, p_end timestamptz)
returns setof public.crocodial_ext_calls language sql stable security definer set search_path = '' as $$
  select x.*
    from public.crocodial_employee_mappings m
    join public.crocodial_ext_calls x on x.connection_id = m.connection_id and x.called_by_ext = m.external_employee_id
   where m.profile_id = p_profile and m.status in ('APPROVED', 'REVOKED') and m.effective_from is not null
     and x.missing_since is null
     and x.call_at >= m.effective_from and x.call_at < coalesce(m.ended_at, 'infinity'::timestamptz)
     and x.call_at >= p_start and x.call_at < p_end
$$;

create or replace function private.croc_call_summary(p_profile uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'made', count(*) filter (where call_type = 'outgoing'),
    'connected', count(*) filter (where call_type = 'outgoing' and connected),
    'notConnected', count(*) filter (where call_type = 'outgoing' and connected = false),
    'connectRate', case when count(*) filter (where call_type = 'outgoing') > 0
                        then round(100.0 * count(*) filter (where call_type = 'outgoing' and connected) / count(*) filter (where call_type = 'outgoing'), 1) end,
    'talkSeconds', coalesce(sum(duration_seconds) filter (where call_type = 'outgoing' and connected), 0),
    'incoming', count(*) filter (where call_type = 'incoming'),
    'missed', count(*) filter (where call_type = 'missed'),
    'uniqueLeads', count(distinct (connection_id, lead_ext)) filter (where call_type = 'outgoing' and lead_ext is not null),
    'uniqueNumbers', count(distinct private.croc_number_key(phone_number)) filter (where call_type = 'outgoing'))
  from private.croc_person_calls(p_profile, p_start, p_end)
$$;

-- CRM demos (ba_demos assigned to the person). A rescheduled demo is one record, counted once.
create or replace function private.croc_demo_summary(p_profile uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'scheduled', count(*) filter (where d.starts_at >= p_start and d.starts_at < p_end and d.status <> 'CANCELLED'),
    'completed', count(*) filter (where d.starts_at >= p_start and d.starts_at < p_end and d.status = 'COMPLETED'),
    'cancelled', count(*) filter (where d.starts_at >= p_start and d.starts_at < p_end and d.status = 'CANCELLED'),
    'upcoming', count(*) filter (where d.starts_at >= now() and d.status in ('SCHEDULED', 'RESCHEDULED')))
  from public.ba_demos d where d.assigned_to = p_profile
$$;

-- ---------------------------------------------------------------------------
-- croc_activity: the same answer as 20270115000300 (same permission check), the figures now from the helpers above
-- ---------------------------------------------------------------------------
create or replace function public.croc_activity(p_profile uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_p uuid := coalesce(p_profile, auth.uid());
  st record;
  w record;
  r jsonb;
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select * into st from private.croc_person_state(v_p);
  if not st.o_enabled then
    -- nothing switched on for this person: the same answer whether or not the caller could see them (no hint of who is mapped)
    if v_p <> v_me and not private.croc_is_admin() then
      raise exception 'NOT_FOUND: Not found.' using errcode = 'P0002';
    end if;
    return jsonb_build_object('enabled', false, 'reason', 'NOT_ENABLED');
  end if;
  if not private.croc_can_view(v_p, st.o_department, st.o_division) then
    raise exception 'NOT_FOUND: Not found.' using errcode = 'P0002';
  end if;
  select * into w from private.croc_window(st.o_tz, p_from, p_to);

  with maps as (
    select m.connection_id, m.external_employee_id as ext, m.effective_from as f, coalesce(m.ended_at, 'infinity'::timestamptz) as t, m.status
      from public.crocodial_employee_mappings m
     where m.profile_id = v_p and m.status in ('APPROVED', 'REVOKED') and m.effective_from is not null
  ),
  calls as (select * from private.croc_person_calls(v_p, w.o_start, w.o_end)),
  fups as (
    select x.* from public.crocodial_ext_followups x join maps on maps.connection_id = x.connection_id and maps.ext = x.created_by_ext
     where x.missing_since is null and coalesce(x.external_created_at, x.scheduled_at) >= maps.f and coalesce(x.external_created_at, x.scheduled_at) < maps.t
  ),
  leads as (
    select x.* from public.crocodial_ext_leads x join maps on maps.connection_id = x.connection_id and maps.ext = x.assigned_to_ext and maps.status = 'APPROVED' and maps.t > now()
     where x.missing_since is null
  )
  select jsonb_build_object(
    'calls', private.croc_call_summary(v_p, w.o_start, w.o_end),
    'followups', (select jsonb_build_object(
        'scheduled', count(*) filter (where scheduled_at >= w.o_start and scheduled_at < w.o_end),
        'completed', count(*) filter (where scheduled_at >= w.o_start and scheduled_at < w.o_end and done),
        'completionRate', case when count(*) filter (where scheduled_at >= w.o_start and scheduled_at < w.o_end) > 0
                               then round(100.0 * count(*) filter (where scheduled_at >= w.o_start and scheduled_at < w.o_end and done)
                                          / count(*) filter (where scheduled_at >= w.o_start and scheduled_at < w.o_end), 1) end,
        'overdue', count(*) filter (where not coalesce(done, false) and scheduled_at < now())) from fups),
    'leads', (select jsonb_build_object('assigned', count(*), 'neverCalled', count(*) filter (where not coalesce(called, false)),
        'followUpDue', count(*) filter (where next_followup_at < now())) from leads),
    'remarks', (select count(*) from public.crocodial_ext_remarks x join maps on maps.connection_id = x.connection_id and maps.ext = x.written_by_ext
                 where x.missing_since is null and coalesce(x.external_created_at, now()) >= maps.f and coalesce(x.external_created_at, now()) < maps.t
                   and x.external_created_at >= w.o_start and x.external_created_at < w.o_end),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
                'made', (select count(*) from calls c where c.call_type = 'outgoing' and (c.call_at at time zone st.o_tz)::date = d::date),
                'connected', (select count(*) from calls c where c.call_type = 'outgoing' and c.connected and (c.call_at at time zone st.o_tz)::date = d::date)) order by d), '[]'::jsonb)
                from generate_series(w.o_from, w.o_to, interval '1 day') d),
    'recentCalls', (select coalesce(jsonb_agg(z order by (z ->> 'callAt') desc), '[]'::jsonb) from (
                select jsonb_build_object('callAt', c.call_at, 'type', c.call_type, 'connected', c.connected, 'durationSeconds', c.duration_seconds,
                       'contactName', coalesce(nullif(btrim(c.contact_name), ''), l.name),
                       'phone', private.croc_mask(c.phone_number),
                       'leadStatus', l.status) as z
                  from calls c left join public.crocodial_ext_leads l on l.connection_id = c.connection_id and l.external_id = c.lead_ext
                 order by c.call_at desc limit 20) q),
    'upcomingFollowups', (select coalesce(jsonb_agg(z order by (z ->> 'scheduledAt')), '[]'::jsonb) from (
                select jsonb_build_object('scheduledAt', f.scheduled_at, 'note', left(f.note, 200), 'leadName', l.name, 'overdue', f.scheduled_at < now()) as z
                  from fups f left join public.crocodial_ext_leads l on l.connection_id = f.connection_id and l.external_id = f.lead_ext
                 where not coalesce(f.done, false) order by f.scheduled_at limit 10) q)
  ) into r;

  return jsonb_build_object(
    'enabled', true,
    'available', st.o_available,
    'stale', st.o_stale,
    'lastSyncAt', st.o_last_ok,
    'timezone', st.o_tz,
    'from', w.o_from, 'to', w.o_to,
    'person', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role, 'salesSubRole', p.sales_sub_role) from public.profiles p where p.id = v_p),
    'demos', private.croc_demo_summary(v_p, w.o_start, w.o_end)
  ) || case when st.o_available then r else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------------------
-- croc_team_activity: as 20270115000400; uniqueLeads / uniqueNumbers in the totals now count each lead / number once across the people
-- ---------------------------------------------------------------------------
create or replace function public.croc_team_activity(p_from date default null, p_to date default null, p_department uuid default null, p_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_people jsonb := '[]'::jsonb;
  v_a jsonb;
  r record;
  w record;
  v_stage text;
  v_leads text[] := '{}';
  v_numbers text[] := '{}';
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  for r in
    select distinct on (p.id) p.id, p.full_name, p.role, p.sales_sub_role, p.team_id, t.name as team_name, m.department_id, d.name as department_name, l.stage,
           coalesce(c.timezone, 'Asia/Kolkata') as tz
      from public.crocodial_employee_mappings m
      join public.profiles p on p.id = m.profile_id and p.status = 'ACTIVE'
      join public.crocodial_connections c on c.id = m.connection_id and c.enabled
      join public.crocodial_department_links l on l.connection_id = m.connection_id and l.department_id = m.department_id and l.division = m.division and l.enabled
      join public.crocodial_rollout ro on ro.department_id = m.department_id and ro.division = m.division and ro.allowed
      left join public.teams t on t.id = p.team_id
      left join public.departments d on d.id = m.department_id
     where m.status = 'APPROVED' and m.ended_at is null
       and (p_department is null or m.department_id = p_department)
       and (p_team is null or p.team_id = p_team)
       and p.id <> v_me
       and private.croc_can_view(p.id, m.department_id, m.division)
     order by p.id, m.approved_at desc
  loop
    v_a := public.croc_activity(r.id, p_from, p_to);
    v_stage := coalesce(v_stage, r.stage);
    if coalesce((v_a ->> 'available')::boolean, false) then
      select * into w from private.croc_window(r.tz, p_from, p_to);
      select v_leads || coalesce(array_agg(distinct x.connection_id::text || ':' || x.lead_ext) filter (where x.lead_ext is not null), '{}'),
             v_numbers || coalesce(array_agg(distinct private.croc_number_key(x.phone_number)) filter (where private.croc_number_key(x.phone_number) is not null), '{}')
        into v_leads, v_numbers
        from private.croc_person_calls(r.id, w.o_start, w.o_end) x where x.call_type = 'outgoing';
    end if;
    v_people := v_people || jsonb_build_object(
      'profileId', r.id, 'name', r.full_name, 'role', r.role, 'salesSubRole', r.sales_sub_role, 'teamId', r.team_id, 'teamName', r.team_name,
      'departmentId', r.department_id, 'departmentName', r.department_name,
      'available', coalesce((v_a ->> 'available')::boolean, false), 'stale', coalesce((v_a ->> 'stale')::boolean, true), 'lastSyncAt', v_a -> 'lastSyncAt',
      'from', v_a -> 'from', 'to', v_a -> 'to',
      'calls', v_a -> 'calls', 'followups', v_a -> 'followups', 'demos', v_a -> 'demos', 'daily', v_a -> 'daily');
  end loop;

  return (
    with ppl as (select x from jsonb_array_elements(v_people) x),
    ok as (select x from ppl where (x ->> 'available')::boolean),
    days as (select (d ->> 'day') as day, sum((d ->> 'made')::int) as made, sum((d ->> 'connected')::int) as connected
               from ok, jsonb_array_elements(coalesce(x -> 'daily', '[]'::jsonb)) d group by 1)
    select jsonb_build_object(
      'connectedEmployees', (select count(*) from ppl),
      'label', 'Crocodial Pilot — ' || (select count(*) from ppl) || ' connected employee' || case when (select count(*) from ppl) = 1 then '' else 's' end,
      'stage', coalesce(v_stage, 'PILOT'),
      'from', (select x -> 'from' from ppl limit 1), 'to', (select x -> 'to' from ppl limit 1),
      'oldestSyncAt', (select min((x ->> 'lastSyncAt')::timestamptz) from ok),
      'anyStale', exists (select 1 from ppl where (x ->> 'stale')::boolean),
      'unavailable', (select count(*) from ppl where not (x ->> 'available')::boolean),
      'people', coalesce((select jsonb_agg(x - 'daily' order by x ->> 'name') from ppl), '[]'::jsonb),
      'totals', jsonb_build_object(
        'made', (select coalesce(sum((x -> 'calls' ->> 'made')::int), 0) from ok),
        'connected', (select coalesce(sum((x -> 'calls' ->> 'connected')::int), 0) from ok),
        'notConnected', (select coalesce(sum((x -> 'calls' ->> 'notConnected')::int), 0) from ok),
        'connectRate', (select case when sum((x -> 'calls' ->> 'made')::int) > 0
                               then round(100.0 * sum((x -> 'calls' ->> 'connected')::int) / sum((x -> 'calls' ->> 'made')::int), 1) end from ok),
        'talkSeconds', (select coalesce(sum((x -> 'calls' ->> 'talkSeconds')::int), 0) from ok),
        'uniqueLeads', (select count(distinct k) from unnest(v_leads) k),
        'uniqueNumbers', (select count(distinct k) from unnest(v_numbers) k),
        'followupsScheduled', (select coalesce(sum((x -> 'followups' ->> 'scheduled')::int), 0) from ok),
        'followupsCompleted', (select coalesce(sum((x -> 'followups' ->> 'completed')::int), 0) from ok),
        'followupsOverdue', (select coalesce(sum((x -> 'followups' ->> 'overdue')::int), 0) from ok),
        'demosScheduled', (select coalesce(sum((x -> 'demos' ->> 'scheduled')::int), 0) from ppl),
        'demosCompleted', (select coalesce(sum((x -> 'demos' ->> 'completed')::int), 0) from ppl)),
      'teams', coalesce((select jsonb_agg(jsonb_build_object('teamId', tid, 'teamName', tname, 'people', n, 'made', made, 'connected', conn) order by tname)
                  from (select x ->> 'teamId' as tid, x ->> 'teamName' as tname, count(*) as n,
                               sum((x -> 'calls' ->> 'made')::int) as made, sum((x -> 'calls' ->> 'connected')::int) as conn
                          from ppl group by 1, 2) g), '[]'::jsonb),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'made', made, 'connected', connected) order by day) from days), '[]'::jsonb),
      'note', 'Totals cover only the connected employees listed here, not the whole department.'
    )
  );
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['private.croc_number_key(text)', 'private.croc_mask(text)', 'private.croc_person_state(uuid)',
    'private.croc_window(text, date, date)', 'private.croc_person_calls(uuid, timestamptz, timestamptz)',
    'private.croc_call_summary(uuid, timestamptz, timestamptz)', 'private.croc_demo_summary(uuid, timestamptz, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.croc_activity(uuid, date, date) from public, anon;
grant execute on function public.croc_activity(uuid, date, date) to authenticated, service_role;
revoke all on function public.croc_team_activity(date, date, uuid, uuid) from public, anon;
grant execute on function public.croc_team_activity(date, date, uuid, uuid) to authenticated, service_role;
