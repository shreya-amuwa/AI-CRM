-- =============================================================================
-- Crocodial: a person's Crocodial leads (the leads assigned to them in Crocodial now). Run after 20270115000600_crocodial_count_from.sql.
-- Additive; safe to run twice. Nothing is written.
--
-- public.croc_leads(profile | null, search, filter, page, page_size): one page of the leads Crocodial reports as assigned to the person through
-- their approved mapping in effect (never another account, never by name). The same people may call it as croc_activity: the person
-- themselves, their own Team Lead, the heads whose scope covers that department's Sales, the Super Admin; anyone else gets "not found".
-- filter: ALL | NEVER_CALLED (not called yet) | FOLLOW_UP_DUE (next follow-up before now). Phone numbers are masked (last 4 digits).
-- =============================================================================
create or replace function public.croc_leads(p_profile uuid default null, p_search text default null, p_filter text default 'ALL',
                                             p_page int default 1, p_page_size int default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_p uuid := coalesce(p_profile, auth.uid());
  m public.crocodial_employee_mappings;
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_filter text := upper(coalesce(p_filter, 'ALL'));
  v_size int := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page int := greatest(coalesce(p_page, 1), 1);
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if v_filter not in ('ALL', 'NEVER_CALLED', 'FOLLOW_UP_DUE') then
    raise exception 'VALIDATION_ERROR: Unknown filter.' using errcode = '22023';
  end if;
  if v_q is not null and length(v_q) > 100 then
    raise exception 'VALIDATION_ERROR: Search for at most 100 characters.' using errcode = '22023';
  end if;
  -- the person's mapping in effect now (connection, department link and rollout switched on)
  select x.* into m
    from public.crocodial_employee_mappings x
   where x.profile_id = v_p and x.status = 'APPROVED' and private.croc_mapping_live(x)
   order by x.approved_at desc limit 1;
  if m.id is null then
    if v_p <> v_me and not private.croc_is_admin() then
      raise exception 'NOT_FOUND: Not found.' using errcode = 'P0002';
    end if;
    return jsonb_build_object('enabled', false, 'reason', 'NOT_ENABLED');
  end if;
  if not private.croc_can_view(v_p, m.department_id, m.division) then
    raise exception 'NOT_FOUND: Not found.' using errcode = 'P0002';
  end if;

  return (
    with mine as (
      select l.* from public.crocodial_ext_leads l
       where l.connection_id = m.connection_id and l.assigned_to_ext = m.external_employee_id and l.missing_since is null
    ),
    hit as (
      select * from mine
       where (v_filter = 'ALL' or (v_filter = 'NEVER_CALLED' and not coalesce(called, false))
              or (v_filter = 'FOLLOW_UP_DUE' and next_followup_at < now()))
         and (v_q is null or name ilike '%' || v_q || '%' or company ilike '%' || v_q || '%' or city ilike '%' || v_q || '%'
              or status ilike '%' || v_q || '%'
              or (length(regexp_replace(v_q, '\D', '', 'g')) >= 4 and regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') like '%' || regexp_replace(v_q, '\D', '', 'g') || '%'))
    ),
    -- follow-ups that are due first, then the next follow-ups, then the most recently worked
    ord as (
      select hit.*, row_number() over (order by (next_followup_at < now()) desc nulls last, next_followup_at nulls last,
                                                coalesce(last_interaction_at, external_created_at) desc nulls last, external_id desc) as rn
        from hit
    )
    select jsonb_build_object(
      'enabled', true,
      'person', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = v_p),
      'counts', (select jsonb_build_object('all', count(*), 'neverCalled', count(*) filter (where not coalesce(called, false)),
                                           'followUpDue', count(*) filter (where next_followup_at < now())) from mine),
      'total', (select count(*) from hit),
      'page', v_page, 'pageSize', v_size,
      'lastSyncAt', (select min(s.last_ok_at) from public.crocodial_sync_state s where s.connection_id = m.connection_id and s.resource = 'leads'),
      'items', coalesce((select jsonb_agg(z order by rn) from (
          select h.rn, jsonb_build_object('id', h.external_id, 'name', h.name, 'company', h.company, 'city', h.city, 'status', h.status, 'source', h.source,
                   'phone', case when length(regexp_replace(coalesce(h.phone_number, ''), '\D', '', 'g')) >= 4
                                 then 'XXXXXX' || right(regexp_replace(h.phone_number, '\D', '', 'g'), 4) end,
                   'called', h.called, 'dialerOutcome', h.dialer_outcome, 'remarkCount', h.remark_count,
                   'nextFollowupAt', h.next_followup_at, 'followUpDue', h.next_followup_at < now(), 'lastInteractionAt', h.last_interaction_at,
                   'createdAt', h.external_created_at,
                   'calls', (select count(*) from public.crocodial_ext_calls c where c.connection_id = h.connection_id and c.lead_ext = h.external_id
                                                                              and c.missing_since is null and c.called_by_ext = m.external_employee_id)) as z
            from ord h
           where h.rn > (v_page - 1) * v_size and h.rn <= v_page * v_size) q), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.croc_leads(uuid, text, text, int, int) from public, anon;
grant execute on function public.croc_leads(uuid, text, text, int, int) to authenticated, service_role;
