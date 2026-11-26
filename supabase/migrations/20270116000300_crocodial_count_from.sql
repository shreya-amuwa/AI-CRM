-- =============================================================================
-- Crocodial: the date a mapping counts activity from. Run after 20270115000500_crocodial_sync_now_minute.sql. Additive; safe to run twice.
--
-- Until now a mapping counted only what happened after its approval, so a person's earlier Crocodial calls, follow-ups and remarks
-- (already stored by the sync) counted for nobody. The Super Admin can now move the start of an approved mapping back:
--   public.croc_mapping_count_from(mapping, from date | null)
--     from = null  -> from the first activity stored for that Crocodial user (calls, follow-ups, remarks), start of that day
--     from = date  -> from the start of that day, in the account's time zone (not in the future)
-- Refused when the new period would overlap another mapping of the same Crocodial user or of the same CRM person on that account, so
-- one record still counts for one person only. Every change is audited with the previous and the new date. Nothing else changes
-- (role, team, the mapping's approval).
-- =============================================================================
create or replace function public.croc_mapping_count_from(p_id uuid, p_from date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.crocodial_employee_mappings;
  v_tz text;
  v_first timestamptz;
  v_start timestamptz;
  v_old timestamptz;
  v_clash text;
begin
  perform private.croc_require_admin();
  select * into m from public.crocodial_employee_mappings where id = p_id for update;
  if m.id is null then
    raise exception 'NOT_FOUND: Mapping not found.' using errcode = 'P0002';
  end if;
  if m.status <> 'APPROVED' or m.ended_at is not null then
    raise exception 'CONFLICT: Only an approved mapping that is in effect can be changed.' using errcode = 'P0001';
  end if;
  select coalesce(c.timezone, 'Asia/Kolkata') into v_tz from public.crocodial_connections c where c.id = m.connection_id;

  if p_from is null then
    select least(
             (select min(x.call_at) from public.crocodial_ext_calls x where x.connection_id = m.connection_id and x.called_by_ext = m.external_employee_id),
             (select min(coalesce(x.external_created_at, x.scheduled_at)) from public.crocodial_ext_followups x
               where x.connection_id = m.connection_id and x.created_by_ext = m.external_employee_id),
             (select min(x.external_created_at) from public.crocodial_ext_remarks x where x.connection_id = m.connection_id and x.written_by_ext = m.external_employee_id))
      into v_first;
    if v_first is null then
      raise exception 'VALIDATION_ERROR: No activity of this Crocodial user is stored yet. Sync first, then try again.' using errcode = '22023';
    end if;
    v_start := ((v_first at time zone v_tz)::date)::timestamp at time zone v_tz;
  else
    if p_from > (now() at time zone v_tz)::date then
      raise exception 'VALIDATION_ERROR: The date cannot be in the future.' using errcode = '22023';
    end if;
    v_start := p_from::timestamp at time zone v_tz;
  end if;

  -- one record counts for one person only: no overlap with another mapping of the same Crocodial user or the same CRM person
  select coalesce(p.full_name, 'another employee') || ' (Crocodial user ' || o.external_employee_id || ', from '
         || to_char(o.effective_from at time zone v_tz, 'DD Mon YYYY')
         || coalesce(' to ' || to_char(o.ended_at at time zone v_tz, 'DD Mon YYYY'), '') || ')'
    into v_clash
    from public.crocodial_employee_mappings o
    left join public.profiles p on p.id = o.profile_id
   where o.connection_id = m.connection_id and o.id <> m.id and o.status in ('APPROVED', 'REVOKED') and o.effective_from is not null
     and (o.external_employee_id = m.external_employee_id or o.profile_id = m.profile_id)
     and coalesce(o.ended_at, 'infinity'::timestamptz) > v_start
   order by o.effective_from desc
   limit 1;
  if v_clash is not null then
    raise exception 'CONFLICT: That date overlaps an earlier mapping: %. Choose a later date.', v_clash using errcode = 'P0001';
  end if;

  v_old := m.effective_from;
  update public.crocodial_employee_mappings set effective_from = v_start where id = m.id returning * into m;
  perform private.write_audit('CROCODIAL_MAPPING_COUNT_FROM_SET', 'crocodial_mapping', m.id, m.department_id, null,
    jsonb_build_object('connectionId', m.connection_id, 'externalEmployeeId', m.external_employee_id, 'profileId', m.profile_id,
                       'previousFrom', v_old, 'from', v_start, 'firstActivity', p_from is null));
  return private.croc_mapping_json(m);
end $$;

revoke all on function public.croc_mapping_count_from(uuid, date) from public, anon;
grant execute on function public.croc_mapping_count_from(uuid, date) to authenticated, service_role;
