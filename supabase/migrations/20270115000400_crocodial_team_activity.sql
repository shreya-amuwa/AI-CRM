-- =============================================================================
-- Crocodial integration, part 4: the management view (docs/CROCODIAL_INTEGRATION.md "Management view").
-- Run after 20270115000300_crocodial_activity.sql. Additive and safe to run twice. Nothing is written.
--
-- public.croc_team_activity(from, to, department, team): one line per connected person THE CALLER MAY SEE, through the existing hierarchy
-- (private.croc_can_view: their own Team Lead, the Department / Operations Heads whose scope covers that department's Sales, the Super
-- Admin), with the same figures and formulas as croc_activity, a total, a breakdown by team and a day-by-day trend.
--
-- The total covers only the connected people listed, never the whole department: the answer says how many ("Crocodial Pilot - N connected
-- employees"). A person who has never been fully synced is listed as "not available" and left out of the total (never counted as zero).
-- =============================================================================

create or replace function public.croc_team_activity(p_from date default null, p_to date default null, p_department uuid default null, p_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_people jsonb := '[]'::jsonb;
  v_a jsonb;
  r record;
  v_stage text;
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  -- the connected people (an approved mapping, switched on) the caller may see; the caller themselves is not "their team"
  for r in
    select distinct on (p.id) p.id, p.full_name, p.role, p.sales_sub_role, p.team_id, t.name as team_name, m.department_id, d.name as department_name, l.stage
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
        'connectRate', (select case when sum((x -> 'calls' ->> 'made')::int) > 0
                               then round(100.0 * sum((x -> 'calls' ->> 'connected')::int) / sum((x -> 'calls' ->> 'made')::int), 1) end from ok),
        'talkSeconds', (select coalesce(sum((x -> 'calls' ->> 'talkSeconds')::int), 0) from ok),
        'uniqueLeads', (select coalesce(sum((x -> 'calls' ->> 'uniqueLeads')::int), 0) from ok),
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

revoke all on function public.croc_team_activity(date, date, uuid, uuid) from public, anon;
grant execute on function public.croc_team_activity(date, date, uuid, uuid) to authenticated, service_role;
