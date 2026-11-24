-- =============================================================================
-- CEO Availability (docs/CEO_AVAILABILITY.md). Run after 20270131000200_company_notice_board.sql. Additive and safe to run twice.
--
-- 20270128000300 stores "the CEO has arrived today" (ceo_office_arrivals) and lets HR press CEO HAS ARRIVED. This adds, on the SAME storage
-- (no second table):
--   * CEO NOT ARRIVED: HR sets the status back (ceo_mark_not_arrived). An arrival recorded today is marked undone (kept for the record);
--     with no arrival today the press is stored as a row of kind NOT_ARRIVED (already "undone", so it never counts as an arrival), so the
--     time and the person of every status update are known without reading the audit log.
--   * the date, time and person of the LATEST status update (updatedAt / updatedBy / updatedStatus) in ceo_office_status(), and `status`
--     ('ARRIVED' | 'NOT_ARRIVED') for each CEO. updatedToday is false when the latest update is from an earlier day.
-- Who may press: private.is_hr_staff() (HR department without the Recruiter designation, and the Super Admin), exactly as before. Everyone
-- signed in reads the status. It NEVER blocks, hides or decides a meeting request: mtg_create does not read it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. What a row records, and the latest status update of one CEO (an arrival, an undone arrival, or an explicit "not arrived")
-- ---------------------------------------------------------------------------
alter table public.ceo_office_arrivals add column if not exists kind text not null default 'ARRIVED';
alter table public.ceo_office_arrivals drop constraint if exists ceo_office_arrivals_kind_check;
alter table public.ceo_office_arrivals add constraint ceo_office_arrivals_kind_check
  check (kind in ('ARRIVED', 'NOT_ARRIVED') and (kind = 'ARRIVED' or undone_at is not null));

create or replace function private.ceo_office_latest(p_ceo uuid)
returns table (at timestamptz, status text, actor uuid) language sql stable security definer set search_path = '' as $$
  select u.at, u.st, u.actor from (
    select x.arrived_at as at, 'ARRIVED'::text as st, x.marked_by as actor from public.ceo_office_arrivals x where x.ceo_id = p_ceo and x.kind = 'ARRIVED'
    union all
    select x.undone_at, 'NOT_ARRIVED', x.undone_by from public.ceo_office_arrivals x where x.ceo_id = p_ceo and x.kind = 'ARRIVED' and x.undone_at is not null
    union all
    select x.arrived_at, 'NOT_ARRIVED', x.marked_by from public.ceo_office_arrivals x where x.ceo_id = p_ceo and x.kind = 'NOT_ARRIVED'
  ) u order by u.at desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- 2. The status as everyone reads it (20270128000300's shape plus status / updatedAt / updatedBy / updatedStatus / updatedToday)
-- ---------------------------------------------------------------------------
create or replace function private.ceo_office_json()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'day', private.ceo_office_day(),
    -- HR staff (and the Super Admin) press the buttons; recruiters and everyone else only read
    'canMark', coalesce(private.is_hr_staff(), false),
    'ceos', coalesce((select jsonb_agg(jsonb_build_object(
        'ceoId', p.id, 'name', p.full_name, 'position', nullif(btrim(coalesce(p.position, '')), ''),
        'arrived', a.id is not null, 'arrivedAt', a.arrived_at, 'markedBy', (select full_name from public.profiles where id = a.marked_by),
        'status', case when a.id is not null then 'ARRIVED' else 'NOT_ARRIVED' end,
        'updatedAt', lu.at, 'updatedStatus', lu.status,
        'updatedBy', (select full_name from public.profiles where id = lu.actor),
        'updatedToday', lu.at is not null and (lu.at at time zone 'Asia/Kolkata')::date = private.ceo_office_day(),
        'presence', coalesce((select mp.status from public.meeting_presence mp where mp.host_id = p.id), 'AVAILABLE')) order by p.created_at, p.id)
      from public.profiles p
      left join public.ceo_office_arrivals a on a.ceo_id = p.id and a.day = private.ceo_office_day() and a.undone_at is null
      left join lateral private.ceo_office_latest(p.id) lu on true
     where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 3. CEO NOT ARRIVED
-- ---------------------------------------------------------------------------
create or replace function public.ceo_mark_not_arrived(p_ceo uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ceo uuid := private.ceo_office_target(p_ceo);
  v_id bigint;
  l record;
begin
  -- an arrival recorded today is undone (the row is kept)
  update public.ceo_office_arrivals set undone_at = now(), undone_by = auth.uid()
   where ceo_id = v_ceo and day = private.ceo_office_day() and undone_at is null and kind = 'ARRIVED'
  returning id into v_id;
  if v_id is not null then
    perform private.write_audit('CEO_OFFICE_ARRIVAL_UNDONE', 'profile', v_ceo, null, null, jsonb_build_object('day', private.ceo_office_day()));
    return private.ceo_office_json() || jsonb_build_object('duplicate', false);
  end if;
  -- already "not arrived" since an update made today: nothing changes (a double press records one update)
  select * into l from private.ceo_office_latest(v_ceo);
  if l.at is not null and l.status = 'NOT_ARRIVED' and (l.at at time zone 'Asia/Kolkata')::date = private.ceo_office_day() then
    return private.ceo_office_json() || jsonb_build_object('duplicate', true);
  end if;
  insert into public.ceo_office_arrivals (ceo_id, day, kind, marked_by, undone_at, undone_by)
  values (v_ceo, private.ceo_office_day(), 'NOT_ARRIVED', auth.uid(), now(), auth.uid());
  perform private.write_audit('CEO_OFFICE_NOT_ARRIVED', 'profile', v_ceo, null, null, jsonb_build_object('day', private.ceo_office_day()));
  return private.ceo_office_json() || jsonb_build_object('duplicate', false);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.ceo_office_latest(uuid)', 'private.ceo_office_json()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.ceo_mark_not_arrived(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
