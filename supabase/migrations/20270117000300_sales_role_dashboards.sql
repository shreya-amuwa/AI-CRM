-- =============================================================================
-- Sales Department Head: role-wise sections (phase 1: Telecaller and Business Associate). Run after 20270117000200_crocodial_field_alignment.sql.
--
-- READ-ONLY. No table, column or row is added or changed.
-- Call figures come ONLY from Crocodial, through the same helpers as "My Crocodial Activity" and the Crocodial management view
-- (private.croc_call_summary / croc_person_calls: calls attributed through the approved mapping, never by name). A person who is not
-- connected to Crocodial, or not synced yet, has no call figures (null, shown as such), never zeros and never figures made up from CRM fields.
-- Demo figures come only from the CRM demo schedule (private.croc_demo_summary, ba_demos; Crocodial has no demo data).
-- The rest are CRM workflow records:
--   Telecaller          leads they own or created (customers), leads they converted to a Business Associate (ba_contacts.telecaller_id)
--   Business Associate  contacts assigned to them (ba_contacts), final quotations (latest revision), deals closed (customers in ONBOARDING /
--                       CUSTOMER, deal amount)
--
-- WHO: only a Sales Department Head (private.require_sales_head()), and only the people of that department's Sales teams with that Sales role.
-- Anyone else gets FORBIDDEN; a person outside the scope is NOT_FOUND. Additive and safe to run twice.
-- =============================================================================

-- The people of one Sales role in the head's active department (Sales teams only), whatever their account status.
create or replace function private.sales_role_people(p_role text)
returns table (id uuid, full_name text, email text, phone text, employee_code text, status text, team_id uuid, team_name text,
               lead_id uuid, lead_name text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.phone,
         -- the Employee ID the HR directory shows (private.hr_mail_employees): the HR record's id, else EMP- and the account id
         coalesce((select y.id from public.hr_employees y
                    where y.profile_id = p.id or (y.profile_id is null and lower(trim(coalesce(y.email, ''))) = p.email)
                    order by (y.profile_id is not null) desc, y.created_at limit 1), 'EMP-' || upper(left(p.id::text, 8))),
         p.status::text, p.team_id, t.name, private.direct_lead_of(p.id),
         (select l.full_name from public.profiles l where l.id = private.direct_lead_of(p.id)),
         p.created_at
    from public.profiles p
    join public.teams t on t.id = p.team_id and t.division = 'SALES'
   where p.department_id = private.my_department_id()
     and p.role = 'TEAM_MEMBER'
     and p.status in ('ACTIVE', 'SUSPENDED', 'REVOKED')
     and case p_role
           when 'TELECALLER' then p.sales_sub_role = 'TELECALLER'
           when 'BUSINESS_ASSOCIATE' then p.sales_sub_role = 'BUSINESS_ASSOCIATE'
           else false end
$$;

-- One person's figures for [start, end) (the list and the dashboard use the same formulas).
create or replace function private.sales_role_metrics(p_role text, p_person uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  st record;
  v_calls jsonb := null;
  v_croc text;
  v jsonb;
begin
  select * into st from private.croc_person_state(p_person);
  v_croc := case when not st.o_enabled then 'OFF' when not st.o_available then 'NOT_SYNCED' else 'ON' end;
  if v_croc = 'ON' then
    v_calls := private.croc_call_summary(p_person, p_start, p_end);
  end if;
  -- Crocodial call figures (null unless connected and synced)
  v := jsonb_build_object(
    'crocodial', v_croc,
    'calls', v_calls -> 'made', 'connected', v_calls -> 'connected', 'notConnected', v_calls -> 'notConnected',
    'connectRate', v_calls -> 'connectRate', 'uniqueNumbers', v_calls -> 'uniqueNumbers', 'talkSeconds', v_calls -> 'talkSeconds');
  if p_role = 'TELECALLER' then
    return v || jsonb_build_object(
      'leadsCreated', (select count(*) from public.customers x where (x.owner_id = p_person or x.created_by = p_person)
                         and x.created_at >= p_start and x.created_at < p_end),
      'convertedLeads', (select count(*) from public.ba_contacts b where b.telecaller_id = p_person and b.created_at >= p_start and b.created_at < p_end));
  end if;
  return v || (
    with demos as (select private.croc_demo_summary(p_person, p_start, p_end) as d),
    deals as (
      select x.* from public.customers x
       where (x.id in (select b.lead_id from public.ba_contacts b where b.assigned_to = p_person) or x.owner_id = p_person)
         and x.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and x.stage_changed_at >= p_start and x.stage_changed_at < p_end
    )
    select jsonb_build_object(
      'leadsAssigned', (select count(*) from public.ba_contacts b where b.assigned_to = p_person and b.assigned_at >= p_start and b.assigned_at < p_end),
      'demosScheduled', (demos.d ->> 'scheduled')::int, 'demosCompleted', (demos.d ->> 'completed')::int,
      'demosCancelled', (demos.d ->> 'cancelled')::int, 'demosUpcoming', (demos.d ->> 'upcoming')::int,
      -- a quotation counts once: its latest final revision, finalised in the period
      'quotations', (select count(distinct q.quotation_no) from public.ba_quotations q join public.ba_contacts b on b.id = q.contact_id
                      where b.assigned_to = p_person and q.status = 'FINAL' and q.finalized_at >= p_start and q.finalized_at < p_end),
      'dealsClosed', (select count(*) from deals),
      'dealValue', (select coalesce(sum(coalesce(deal_amount, agreed_amount, 0)), 0) from deals))
    from demos);
end $$;

-- The period: [from, to] in India time (the Crocodial pilot account's time zone); default the last 30 days; at most 93 days (as Crocodial).
create or replace function private.sales_role_period(p_from date, p_to date, out o_from date, out o_to date, out o_start timestamptz, out o_end timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  select w.o_from, w.o_to, w.o_start, w.o_end into o_from, o_to, o_start, o_end
    from private.croc_window('Asia/Kolkata', coalesce(p_from, coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date) - 29), p_to) w;
end $$;

-- ---------------------------------------------------------------------------
-- The list of one role
-- ---------------------------------------------------------------------------
create or replace function public.sales_role_list(p_role text, p_from date default null, p_to date default null, p_search text default null,
  p_team_lead uuid default null, p_status text default null, p_sort text default 'name', p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  per record;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 500);
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_rows jsonb;
begin
  perform private.require_sales_head();
  if p_role not in ('TELECALLER', 'BUSINESS_ASSOCIATE') then
    raise exception 'VALIDATION_ERROR: Choose TELECALLER or BUSINESS_ASSOCIATE.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'SUSPENDED', 'REVOKED') then
    raise exception 'VALIDATION_ERROR: Choose ACTIVE, SUSPENDED or REVOKED.' using errcode = '22023';
  end if;
  select * into per from private.sales_role_period(p_from, p_to);

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'employeeCode', p.employee_code,
                              'status', p.status, 'teamId', p.team_id, 'teamName', p.team_name, 'teamLeadId', p.lead_id, 'teamLeadName', p.lead_name,
                              'metrics', private.sales_role_metrics(p_role, p.id, per.o_start, per.o_end)) as x
      from private.sales_role_people(p_role) p
     where (v_term is null or lower(p.full_name) like '%' || v_term || '%' or lower(coalesce(p.employee_code, '')) like '%' || v_term || '%'
            or lower(coalesce(p.email, '')) like '%' || v_term || '%' or coalesce(p.phone, '') like '%' || v_term || '%')
       and (p_team_lead is null or p.lead_id = p_team_lead)
       and (p_status is null or p.status = p_status)) q;

  return jsonb_build_object(
    'role', p_role, 'from', per.o_from, 'to', per.o_to,
    'total', jsonb_array_length(v_rows), 'page', v_page, 'pageSize', v_size,
    -- every Team Lead of the role's people, for the filter (whatever else is filtered)
    'teamLeads', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.lead_id, 'name', p.lead_name)) from private.sales_role_people(p_role) p where p.lead_id is not null), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(x order by
                case when p_sort in ('name', 'teamLead', 'status') then null else (x -> 'metrics' ->> p_sort)::numeric end desc nulls last,
                case p_sort when 'teamLead' then x ->> 'teamLeadName' when 'status' then x ->> 'status' else null end,
                lower(x ->> 'name'))
              from (select x from jsonb_array_elements(v_rows) x
                     order by case when p_sort in ('name', 'teamLead', 'status') then null else (x -> 'metrics' ->> p_sort)::numeric end desc nulls last,
                              case p_sort when 'teamLead' then x ->> 'teamLeadName' when 'status' then x ->> 'status' else null end,
                              lower(x ->> 'name')
                     offset (v_page - 1) * v_size limit v_size) s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- One person's dashboard
-- ---------------------------------------------------------------------------
create or replace function public.sales_role_person(p_role text, p_profile uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  per record;
  p record;
  st record;
  v_on boolean;
  v_records jsonb;
  v_daily jsonb;
  v_calls jsonb := '[]'::jsonb;
begin
  perform private.require_sales_head();
  if p_role not in ('TELECALLER', 'BUSINESS_ASSOCIATE') then
    raise exception 'VALIDATION_ERROR: Choose TELECALLER or BUSINESS_ASSOCIATE.' using errcode = '22023';
  end if;
  select * into p from private.sales_role_people(p_role) x where x.id = p_profile;
  if p.id is null then
    raise exception 'NOT_FOUND: This person is not in your Sales teams.' using errcode = 'P0002';
  end if;
  select * into per from private.sales_role_period(p_from, p_to);
  select * into st from private.croc_person_state(p.id);
  v_on := st.o_enabled and st.o_available;

  -- the Crocodial call log of the period (the same calls the figures count), newest first; numbers masked as everywhere else
  if v_on then
    select coalesce(jsonb_agg(z order by (z ->> 'callAt') desc), '[]'::jsonb) into v_calls from (
      select jsonb_build_object('id', c.external_id, 'callAt', c.call_at, 'type', c.call_type, 'connected', c.connected, 'durationSeconds', c.duration_seconds,
                                'contactName', coalesce(nullif(btrim(c.contact_name), ''), l.name), 'phone', private.croc_mask(c.phone_number),
                                'leadStatus', l.status) as z
        from private.croc_person_calls(p.id, per.o_start, per.o_end) c
        left join public.crocodial_ext_leads l on l.connection_id = c.connection_id and l.external_id = c.lead_ext
       order by c.call_at desc limit 500) q;
  end if;

  if p_role = 'TELECALLER' then
    select coalesce(jsonb_agg(jsonb_build_object('day', (d at time zone 'Asia/Kolkata')::date,
             'calls', case when v_on then (select count(*) from private.croc_person_calls(p.id, d, d + interval '1 day') c where c.call_type = 'outgoing') end,
             'connected', case when v_on then (select count(*) from private.croc_person_calls(p.id, d, d + interval '1 day') c where c.call_type = 'outgoing' and c.connected) end,
             'leads', (select count(*) from public.customers x where (x.owner_id = p.id or x.created_by = p.id) and x.created_at >= d and x.created_at < d + interval '1 day'),
             'converted', (select count(*) from public.ba_contacts b where b.telecaller_id = p.id and b.created_at >= d and b.created_at < d + interval '1 day'))
             order by d), '[]'::jsonb) into v_daily
      from generate_series(per.o_start, per.o_end - interval '1 day', interval '1 day') d;
    select jsonb_build_object(
      'calls', v_calls,
      'leads', coalesce((select jsonb_agg(z order by (z ->> 'createdAt') desc) from (
          select jsonb_build_object('id', x.id, 'name', x.name, 'company', x.company, 'stage', x.lifecycle_stage, 'leadStatus', x.lead_status,
                                    'convertedTo', (select pb.full_name from public.ba_contacts b join public.profiles pb on pb.id = b.assigned_to where b.lead_id = x.id),
                                    'createdAt', x.created_at) as z
            from public.customers x
           where (x.owner_id = p.id or x.created_by = p.id) and x.created_at >= per.o_start and x.created_at < per.o_end
           order by x.created_at desc limit 500) q), '[]'::jsonb)
    ) into v_records;
  else
    select coalesce(jsonb_agg(jsonb_build_object('day', (d at time zone 'Asia/Kolkata')::date,
             'assigned', (select count(*) from public.ba_contacts b where b.assigned_to = p.id and b.assigned_at >= d and b.assigned_at < d + interval '1 day'),
             'demos', (select count(*) from public.ba_demos m where m.assigned_to = p.id and m.status <> 'CANCELLED' and m.starts_at >= d and m.starts_at < d + interval '1 day'),
             'demosCompleted', (select count(*) from public.ba_demos m where m.assigned_to = p.id and m.status = 'COMPLETED' and m.starts_at >= d and m.starts_at < d + interval '1 day'),
             'deals', (select count(*) from public.customers x where (x.id in (select b.lead_id from public.ba_contacts b where b.assigned_to = p.id) or x.owner_id = p.id)
                         and x.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and x.stage_changed_at >= d and x.stage_changed_at < d + interval '1 day'))
             order by d), '[]'::jsonb) into v_daily
      from generate_series(per.o_start, per.o_end - interval '1 day', interval '1 day') d;
    select jsonb_build_object(
      'calls', v_calls,
      'contacts', coalesce((select jsonb_agg(z order by (z ->> 'assignedAt') desc) from (
          select jsonb_build_object('id', b.id, 'name', x.name, 'company', x.company, 'stage', b.stage, 'assignedAt', b.assigned_at,
                                    'telecaller', (select t.full_name from public.profiles t where t.id = b.telecaller_id)) as z
            from public.ba_contacts b join public.customers x on x.id = b.lead_id
           where b.assigned_to = p.id and b.assigned_at >= per.o_start and b.assigned_at < per.o_end order by b.assigned_at desc limit 500) q), '[]'::jsonb),
      'demos', coalesce((select jsonb_agg(z order by (z ->> 'startsAt') desc) from (
          select jsonb_build_object('id', m.id, 'title', m.title, 'client', x.name, 'startsAt', m.starts_at, 'mode', m.mode, 'status', m.status) as z
            from public.ba_demos m join public.ba_contacts b on b.id = m.contact_id join public.customers x on x.id = b.lead_id
           where m.assigned_to = p.id and m.starts_at >= per.o_start and m.starts_at < per.o_end order by m.starts_at desc limit 500) q), '[]'::jsonb),
      'quotations', coalesce((select jsonb_agg(z order by (z ->> 'finalizedAt') desc) from (
          select distinct on (q.quotation_no)
                 jsonb_build_object('id', q.id, 'number', q.quotation_no, 'revision', q.revision, 'client', x.name, 'total', q.total, 'finalizedAt', q.finalized_at) as z
            from public.ba_quotations q join public.ba_contacts b on b.id = q.contact_id join public.customers x on x.id = b.lead_id
           where b.assigned_to = p.id and q.status = 'FINAL' and q.finalized_at >= per.o_start and q.finalized_at < per.o_end
           order by q.quotation_no, q.revision desc limit 500) q2), '[]'::jsonb),
      'deals', coalesce((select jsonb_agg(z order by (z ->> 'closedAt') desc) from (
          select jsonb_build_object('id', x.id, 'name', x.name, 'company', x.company, 'stage', x.lifecycle_stage,
                                    'dealAmount', coalesce(x.deal_amount, x.agreed_amount), 'closedAt', x.stage_changed_at) as z
            from public.customers x
           where (x.id in (select b.lead_id from public.ba_contacts b where b.assigned_to = p.id) or x.owner_id = p.id)
             and x.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and x.stage_changed_at >= per.o_start and x.stage_changed_at < per.o_end
           order by x.stage_changed_at desc limit 500) q), '[]'::jsonb)
    ) into v_records;
  end if;

  return jsonb_build_object(
    'role', p_role, 'from', per.o_from, 'to', per.o_to,
    'person', jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'employeeCode', p.employee_code, 'status', p.status,
                                 'teamId', p.team_id, 'teamName', p.team_name, 'teamLeadId', p.lead_id, 'teamLeadName', p.lead_name, 'joinedAt', p.joined_at),
    'metrics', private.sales_role_metrics(p_role, p.id, per.o_start, per.o_end),
    'crocodial', jsonb_build_object('state', case when not st.o_enabled then 'OFF' when not st.o_available then 'NOT_SYNCED' else 'ON' end,
                                    'lastSyncAt', st.o_last_ok, 'stale', st.o_enabled and st.o_stale),
    'daily', v_daily,
    'records', v_records);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['private.sales_role_people(text)', 'private.sales_role_metrics(text, uuid, timestamptz, timestamptz)',
    'private.sales_role_period(date, date)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.sales_role_list(text, date, date, text, uuid, text, text, integer, integer)', 'public.sales_role_person(text, uuid, date, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
