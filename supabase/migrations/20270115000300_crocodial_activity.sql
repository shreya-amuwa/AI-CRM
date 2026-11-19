-- =============================================================================
-- Crocodial integration, part 3: a person's Crocodial activity (docs/CROCODIAL_INTEGRATION.md "Metrics").
-- Run after 20270115000200_crocodial_sync.sql. Additive and safe to run twice. Nothing is written.
--
-- public.croc_activity(profile, from, to): the activity of ONE person, for the person themselves and (part 4) the people allowed to see
-- them (private.croc_can_view: their own Team Lead, the heads whose scope covers that department's Sales, the Super Admin). Anyone else
-- gets "not found", whatever id they send.
--
-- Attribution: a record counts for the person only through an approved mapping of that account that was in effect at the record's time
-- (calls: call_at; follow-ups: created; remarks: written). Records of unmapped Crocodial users count for nobody. Nothing is matched by name.
-- Unavailable is not zero: no approved mapping -> enabled false; never synced -> available false (no figures at all); data older than
-- 24 hours -> stale true (figures shown, labelled as not current).
--
-- Formulas (dates are days in the account's time zone, both ends included):
--   callsMade       outgoing calls made by the person in the period
--   connected       of those, connected = true;  connectRate = connected / callsMade (null when no calls were made)
--   talkSeconds     duration of the connected outgoing calls
--   incoming/missed calls of those types attributed to the person
--   uniqueLeads     distinct Crocodial leads of the outgoing calls (calls without a lead are not counted here)
--   followups       scheduled: created by the person, due in the period; completed: of those, done; completionRate = completed / scheduled;
--                   overdue: created by the person, not done, due before now (any date)
--   leads           assigned to the person in Crocodial now (as Crocodial reports it; not the CRM owner)
--   demos (CRM ba_demos, assigned_to = the person): scheduled = starting in the period and not cancelled; completed = of those, COMPLETED;
--                   cancelled = starting in the period, CANCELLED; upcoming = starting from now, SCHEDULED or RESCHEDULED. A rescheduled
--                   demo is one record, counted once.
-- =============================================================================

create index if not exists crocodial_ext_calls_lead on public.crocodial_ext_calls (connection_id, lead_ext);

create or replace function public.croc_activity(p_profile uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_p uuid := coalesce(p_profile, auth.uid());
  v_dept uuid;
  v_div text;
  v_tz text;
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
  v_last_ok timestamptz;
  v_never boolean;
  r jsonb;
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  -- the person's mappings whose connection, department link and rollout are switched on now (history included: revoked mappings still
  -- attribute what happened while they were in effect)
  select m.department_id, m.division, coalesce(c.timezone, 'Asia/Kolkata')
    into v_dept, v_div, v_tz
    from public.crocodial_employee_mappings m
    join public.crocodial_connections c on c.id = m.connection_id and c.enabled
    join public.crocodial_department_links l on l.connection_id = m.connection_id and l.department_id = m.department_id and l.division = m.division and l.enabled
    join public.crocodial_rollout ro on ro.department_id = m.department_id and ro.division = m.division and ro.allowed
   where m.profile_id = v_p and m.status in ('APPROVED', 'REVOKED') and m.effective_from is not null
   order by (m.status = 'APPROVED') desc, m.effective_from desc
   limit 1;
  if v_dept is null then
    -- nothing switched on for this person: the same answer whether or not the caller could see them (no hint of who is mapped)
    if v_p <> v_me and not private.croc_is_admin() then
      raise exception 'NOT_FOUND: Not found.' using errcode = 'P0002';
    end if;
    return jsonb_build_object('enabled', false, 'reason', 'NOT_ENABLED');
  end if;
  if not private.croc_can_view(v_p, v_dept, v_div) then
    raise exception 'NOT_FOUND: Not found.' using errcode = 'P0002';
  end if;

  v_to := coalesce(p_to, (now() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 6);
  if v_from > v_to then
    raise exception 'VALIDATION_ERROR: The start date is after the end date.' using errcode = '22023';
  end if;
  if v_to - v_from > 92 then
    raise exception 'VALIDATION_ERROR: Choose at most 93 days.' using errcode = '22023';
  end if;
  v_start := v_from::timestamp at time zone v_tz;
  v_end := (v_to + 1)::timestamp at time zone v_tz;

  -- freshness: the oldest complete read of the person's connections (all four kinds of data)
  select min(s.last_ok_at), bool_or(s.last_ok_at is null) or count(s.*) < 4 * count(distinct m.connection_id)
    into v_last_ok, v_never
    from public.crocodial_employee_mappings m
    left join public.crocodial_sync_state s on s.connection_id = m.connection_id
   where m.profile_id = v_p and m.status in ('APPROVED', 'REVOKED');

  with maps as (
    select m.connection_id, m.external_employee_id as ext, m.effective_from as f, coalesce(m.ended_at, 'infinity'::timestamptz) as t, m.status
      from public.crocodial_employee_mappings m
     where m.profile_id = v_p and m.status in ('APPROVED', 'REVOKED') and m.effective_from is not null
  ),
  calls as (
    select x.* from public.crocodial_ext_calls x join maps on maps.connection_id = x.connection_id and maps.ext = x.called_by_ext
     where x.missing_since is null and x.call_at >= maps.f and x.call_at < maps.t and x.call_at >= v_start and x.call_at < v_end
  ),
  fups as (
    select x.* from public.crocodial_ext_followups x join maps on maps.connection_id = x.connection_id and maps.ext = x.created_by_ext
     where x.missing_since is null and coalesce(x.external_created_at, x.scheduled_at) >= maps.f and coalesce(x.external_created_at, x.scheduled_at) < maps.t
  ),
  leads as (
    select x.* from public.crocodial_ext_leads x join maps on maps.connection_id = x.connection_id and maps.ext = x.assigned_to_ext and maps.status = 'APPROVED' and maps.t > now()
     where x.missing_since is null
  )
  select jsonb_build_object(
    'calls', (select jsonb_build_object(
        'made', count(*) filter (where call_type = 'outgoing'),
        'connected', count(*) filter (where call_type = 'outgoing' and connected),
        'connectRate', case when count(*) filter (where call_type = 'outgoing') > 0
                            then round(100.0 * count(*) filter (where call_type = 'outgoing' and connected) / count(*) filter (where call_type = 'outgoing'), 1) end,
        'talkSeconds', coalesce(sum(duration_seconds) filter (where call_type = 'outgoing' and connected), 0),
        'incoming', count(*) filter (where call_type = 'incoming'),
        'missed', count(*) filter (where call_type = 'missed'),
        'uniqueLeads', count(distinct (connection_id, lead_ext)) filter (where call_type = 'outgoing' and lead_ext is not null)) from calls),
    'followups', (select jsonb_build_object(
        'scheduled', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end),
        'completed', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and done),
        'completionRate', case when count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end) > 0
                               then round(100.0 * count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and done)
                                          / count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end), 1) end,
        'overdue', count(*) filter (where not coalesce(done, false) and scheduled_at < now())) from fups),
    'leads', (select jsonb_build_object('assigned', count(*), 'neverCalled', count(*) filter (where not coalesce(called, false)),
        'followUpDue', count(*) filter (where next_followup_at < now())) from leads),
    'remarks', (select count(*) from public.crocodial_ext_remarks x join maps on maps.connection_id = x.connection_id and maps.ext = x.written_by_ext
                 where x.missing_since is null and coalesce(x.external_created_at, now()) >= maps.f and coalesce(x.external_created_at, now()) < maps.t
                   and x.external_created_at >= v_start and x.external_created_at < v_end),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
                'made', (select count(*) from calls c where c.call_type = 'outgoing' and (c.call_at at time zone v_tz)::date = d::date),
                'connected', (select count(*) from calls c where c.call_type = 'outgoing' and c.connected and (c.call_at at time zone v_tz)::date = d::date)) order by d), '[]'::jsonb)
                from generate_series(v_from, v_to, interval '1 day') d),
    'recentCalls', (select coalesce(jsonb_agg(z order by (z ->> 'callAt') desc), '[]'::jsonb) from (
                select jsonb_build_object('callAt', c.call_at, 'type', c.call_type, 'connected', c.connected, 'durationSeconds', c.duration_seconds,
                       'contactName', coalesce(nullif(btrim(c.contact_name), ''), l.name),
                       'phone', case when length(regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g')) >= 4
                                     then 'XXXXXX' || right(regexp_replace(c.phone_number, '\D', '', 'g'), 4) end,
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
    'available', not coalesce(v_never, true) and v_last_ok is not null,
    'stale', v_last_ok is null or v_last_ok < now() - interval '24 hours',
    'lastSyncAt', v_last_ok,
    'timezone', v_tz,
    'from', v_from, 'to', v_to,
    'person', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role, 'salesSubRole', p.sales_sub_role) from public.profiles p where p.id = v_p),
    'demos', (select jsonb_build_object(
        'scheduled', count(*) filter (where d.starts_at >= v_start and d.starts_at < v_end and d.status <> 'CANCELLED'),
        'completed', count(*) filter (where d.starts_at >= v_start and d.starts_at < v_end and d.status = 'COMPLETED'),
        'cancelled', count(*) filter (where d.starts_at >= v_start and d.starts_at < v_end and d.status = 'CANCELLED'),
        'upcoming', count(*) filter (where d.starts_at >= now() and d.status in ('SCHEDULED', 'RESCHEDULED')))
        from public.ba_demos d where d.assigned_to = v_p)
  ) || case when not coalesce(v_never, true) and v_last_ok is not null then r else '{}'::jsonb end;
end $$;

revoke all on function public.croc_activity(uuid, date, date) from public, anon;
grant execute on function public.croc_activity(uuid, date, date) to authenticated, service_role;
