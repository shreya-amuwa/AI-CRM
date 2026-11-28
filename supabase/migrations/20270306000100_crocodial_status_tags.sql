-- =============================================================================
-- Crocodial statuses onto lead tags: a status mapping points to a lead tag (or "Ignore") instead of a CRM disposition, and reconciliation
-- sets the lead's tag (the customers_lead_tag_sync trigger of 20270305000100 then sets lead_status to the tag's stage).
-- docs/superpowers/specs/2026-11-27-lead-tags-and-ceo-crocodial-connections-design.md, "Part 2: Crocodial status mapping onto tags".
--
-- Rules (enforced here, not in the browser):
--  * A mapped tag must be usable (private.lead_tag_usable) in EVERY department linked to the connection: company-wide tags always are.
--  * The existing safety rules stay: a record past the LEAD stage is never changed, "Ready to buy" never changes the lifecycle, an unknown
--    status changes nothing and is listed; an ignored status changes nothing (and is not listed as unknown).
--  * Existing disposition mappings migrate to the seed tags: NEW -> New; CONTACTED, FOLLOW_UP, NOT_INTERESTED, LOST -> Contacted;
--    INTERESTED, DEMO_SCHEDULED -> Interested; CONVERTED -> Ready to buy; IGNORE -> Ignore. The disposition column stays readable for one
--    release (kept in step: a tag's stage gives NEW / CONTACTED / INTERESTED / CONVERTED, Ignore gives IGNORE) and is dropped later.
--  * A new (or moved) department link: the connection's mappings whose tag is not usable there are set back to "not mapped" (tag and
--    disposition cleared, listed as unknown again); the count is audited (CROCODIAL_STATUS_MAPPINGS_RESET).
--  * The old croc_status_mapping_set(connection, status, disposition) keeps working and is translated with the same table.
--  * Who may map: unchanged (private.require_super_admin()) in this migration.
-- Additive and safe to run twice; pasteable in the SQL editor. Nothing is deleted.
--
-- Rollback: the old disposition column is still written, so reverting the app is safe with this left in place. To undo it entirely,
-- re-run the croc_reconcile_one, croc_status_mapping_set and croc_reconcile_overview definitions of 20270304000100, then:
--   drop trigger if exists crocodial_department_links_status_tags on public.crocodial_department_links;
--   drop function if exists private.tg_croc_links_status_tags();
--   drop function if exists public.croc_status_mapping_tag_set(uuid, text, uuid, boolean);
--   drop function if exists private.croc_status_mapping_write(uuid, text, uuid, boolean, text);
--   delete from public.crocodial_status_mappings where disposition is null;
--   alter table public.crocodial_status_mappings alter column disposition set not null;
--   alter table public.crocodial_status_mappings drop constraint if exists crocodial_status_mappings_tag_or_ignore_check;
--   alter table public.crocodial_status_mappings drop column if exists ignored, drop column if exists tag_id;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The mapping points to a tag (or Ignore); the backfill from the old dispositions
-- ---------------------------------------------------------------------------
alter table public.crocodial_status_mappings add column if not exists tag_id uuid references public.lead_tags (id) on delete set null;
alter table public.crocodial_status_mappings add column if not exists ignored boolean not null default false;
-- a mapping reset by a new department link keeps its row with no tag, no Ignore and no disposition ("not mapped")
alter table public.crocodial_status_mappings alter column disposition drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crocodial_status_mappings_tag_or_ignore_check') then
    alter table public.crocodial_status_mappings add constraint crocodial_status_mappings_tag_or_ignore_check check (not (ignored and tag_id is not null));
  end if;
end $$;

-- only rows not yet carried over (no tag, not ignored, an old disposition): a second run, or a reset mapping, changes nothing
update public.crocodial_status_mappings set ignored = true
 where disposition = 'IGNORE' and tag_id is null and not ignored;
update public.crocodial_status_mappings set tag_id = private.lead_tag_seed(private.croc_disposition_status(disposition))
 where disposition is not null and disposition <> 'IGNORE' and tag_id is null and not ignored;

-- ---------------------------------------------------------------------------
-- 2. Setting a mapping
-- ---------------------------------------------------------------------------
-- The one writer of a mapping (callers check who may). p_tag null and p_ignore false: the mapping is removed. p_disposition: what the
-- disposition column keeps (the old call passes its own; null: derived from the tag's stage, or IGNORE).
create or replace function private.croc_status_mapping_write(p_connection uuid, p_status text, p_tag uuid, p_ignore boolean, p_disposition text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text := lower(btrim(coalesce(p_status, '')));
  v_ignore boolean := coalesce(p_ignore, false);
  v_stage text;
  v_disp text;
begin
  if length(v_key) not between 1 and 80 then raise exception 'VALIDATION_ERROR: Enter the Crocodial status.' using errcode = 'P0001'; end if;
  if v_ignore and p_tag is not null then raise exception 'VALIDATION_ERROR: Choose a tag or Ignore, not both.' using errcode = 'P0001'; end if;
  -- serialised with a new department link (private.tg_croc_links_status_tags), so a tag is never mapped while a link it can't serve is added
  perform 1 from public.crocodial_connections where id = p_connection for no key update;
  if not found then raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0001'; end if;
  if p_tag is null and not v_ignore then
    delete from public.crocodial_status_mappings where connection_id = p_connection and external_status = v_key;
  else
    if p_tag is not null then
      select t.stage into v_stage from public.lead_tags t where t.id = p_tag;
      if v_stage is null then raise exception 'NOT_FOUND: Tag not found.' using errcode = 'P0001'; end if;
      if exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection and not private.lead_tag_usable(p_tag, l.department_id))
         or (not exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection) and not private.lead_tag_usable(p_tag, null)) then
        raise exception 'VALIDATION_ERROR: That tag can''t be used in every department of this connection.' using errcode = 'P0001';
      end if;
    end if;
    v_disp := coalesce(p_disposition, case when v_ignore then 'IGNORE'
                                           else case v_stage when 'NEW' then 'NEW' when 'CONTACTED' then 'CONTACTED' when 'INTERESTED' then 'INTERESTED'
                                                             when 'READY_TO_BUY' then 'CONVERTED' end end);
    insert into public.crocodial_status_mappings (connection_id, external_status, tag_id, ignored, disposition, updated_by)
    values (p_connection, v_key, p_tag, v_ignore, v_disp, private.my_id())
    on conflict (connection_id, external_status) do update set tag_id = excluded.tag_id, ignored = excluded.ignored, disposition = excluded.disposition,
      updated_by = excluded.updated_by, updated_at = now();
  end if;
  -- the leads with this status are looked at again on the next run
  update public.crocodial_crm_lead_links k set last_external_update = null
    from public.crocodial_ext_leads e
   where k.connection_id = p_connection and e.connection_id = k.connection_id and e.external_id = k.external_lead_id and lower(btrim(e.status)) = v_key;
  perform private.write_audit('CROCODIAL_STATUS_MAPPING_SET', 'crocodial_connection', p_connection, null, null,
    jsonb_build_object('status', v_key, 'tagId', p_tag, 'ignored', v_ignore, 'disposition', v_disp));
  return jsonb_build_object('status', v_key, 'tagId', p_tag, 'ignored', v_ignore, 'disposition', v_disp);
end $$;
revoke all on function private.croc_status_mapping_write(uuid, text, uuid, boolean, text) from public, anon, authenticated;

-- Map a Crocodial status to a tag (p_tag), to Ignore (p_ignore), or remove the mapping (neither).
create or replace function public.croc_status_mapping_tag_set(p_connection uuid, p_status text, p_tag uuid, p_ignore boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return private.croc_status_mapping_write(p_connection, p_status, p_tag, p_ignore, null);
end $$;
revoke all on function public.croc_status_mapping_tag_set(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.croc_status_mapping_tag_set(uuid, text, uuid, boolean) to authenticated;

-- The old call (a disposition), translated with the migration's table: IGNORE -> Ignore, any other -> the seed tag of its stage.
create or replace function public.croc_status_mapping_set(p_connection uuid, p_status text, p_disposition text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  if p_disposition is not null and p_disposition not in ('NEW', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'DEMO_SCHEDULED', 'NOT_INTERESTED', 'LOST', 'CONVERTED', 'IGNORE') then
    raise exception 'VALIDATION_ERROR: Unknown CRM disposition.' using errcode = 'P0001';
  end if;
  return private.croc_status_mapping_write(p_connection, p_status,
    case when p_disposition <> 'IGNORE' then private.lead_tag_seed(private.croc_disposition_status(p_disposition)) end,
    coalesce(p_disposition = 'IGNORE', false), p_disposition);
end $$;
revoke all on function public.croc_status_mapping_set(uuid, text, text) from public, anon;
grant execute on function public.croc_status_mapping_set(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A new department link: mappings whose tag it can't use go back to "not mapped"
-- ---------------------------------------------------------------------------
create or replace function private.tg_croc_links_status_tags()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reset text[];
begin
  perform 1 from public.crocodial_connections where id = new.connection_id for no key update;
  with r as (
    update public.crocodial_status_mappings s set tag_id = null, disposition = null, updated_at = now()
     where s.connection_id = new.connection_id and s.tag_id is not null
       and exists (select 1 from public.crocodial_department_links l where l.connection_id = s.connection_id and not private.lead_tag_usable(s.tag_id, l.department_id))
    returning s.external_status)
  select coalesce(array_agg(external_status order by external_status), '{}') into v_reset from r;
  if cardinality(v_reset) > 0 then
    -- their leads are looked at again (listed as an unknown status)
    update public.crocodial_crm_lead_links k set last_external_update = null
      from public.crocodial_ext_leads e
     where k.connection_id = new.connection_id and e.connection_id = k.connection_id and e.external_id = k.external_lead_id and lower(btrim(e.status)) = any (v_reset);
    perform private.write_audit('CROCODIAL_STATUS_MAPPINGS_RESET', 'crocodial_connection', new.connection_id, new.department_id, null,
      jsonb_build_object('reset', cardinality(v_reset), 'statuses', to_jsonb(v_reset), 'reason', 'tag not usable in a linked department'));
  end if;
  return null;
end $$;
revoke all on function private.tg_croc_links_status_tags() from public, anon, authenticated;
drop trigger if exists crocodial_department_links_status_tags on public.crocodial_department_links;
create trigger crocodial_department_links_status_tags after insert or update of connection_id, department_id on public.crocodial_department_links
  for each row execute function private.tg_croc_links_status_tags();

-- ---------------------------------------------------------------------------
-- 4. Reconciliation writes the tag (copied from 20270304000100; only the mapping lookup and the lead_status writes change)
-- ---------------------------------------------------------------------------
create or replace function private.croc_reconcile_one(p_connection uuid, p_ext bigint, p_apply boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  e public.crocodial_ext_leads;
  lk public.crocodial_crm_lead_links;
  m public.crocodial_employee_mappings;
  o public.profiles;
  c public.customers;
  v_mode text;
  v_disp text;
  v_tag uuid;
  v_ignored boolean;
  v_status text;
  v_cands uuid[];
  v_n integer;
  v_result text := 'UNCHANGED';
  v_new uuid;
  v_local_newer boolean;
begin
  select * into e from public.crocodial_ext_leads where connection_id = p_connection and external_id = p_ext;
  if e.external_id is null then return 'UNCHANGED'; end if;
  select * into lk from public.crocodial_crm_lead_links where connection_id = p_connection and external_lead_id = p_ext for update;
  select s.tag_id, s.ignored, s.disposition into v_tag, v_ignored, v_disp
    from public.crocodial_status_mappings s where s.connection_id = p_connection and s.external_status = lower(btrim(e.status));
  v_ignored := coalesce(v_ignored, false);

  -- the CRM person Crocodial assigned it to: an approved mapping in effect now, never a name
  if e.assigned_to_ext is not null then
    select * into m from public.crocodial_employee_mappings x
     where x.connection_id = p_connection and x.external_employee_id = e.assigned_to_ext and x.status = 'APPROVED'
       and x.effective_from is not null and x.effective_from <= now() and x.ended_at is null
     order by x.effective_from desc limit 1;
  end if;
  if m.profile_id is not null then
    select * into o from public.profiles where id = m.profile_id;
    select l.lead_import into v_mode from public.crocodial_department_links l
      join public.crocodial_rollout r on r.department_id = l.department_id and r.division = l.division and r.allowed
     where l.connection_id = p_connection and l.department_id = m.department_id and l.division = m.division and l.enabled;
  end if;

  if lk.id is null then
    insert into public.crocodial_crm_lead_links (connection_id, external_lead_id, status) values (p_connection, p_ext, 'NOT_ENABLED') returning * into lk;
  end if;

  -- holds that need nobody's data changed
  if m.profile_id is null then
    v_status := 'UNMAPPED_ASSIGNEE';
  elsif coalesce(v_mode, 'OFF') = 'OFF' then
    v_status := 'NOT_ENABLED';
  elsif o.id is null or o.status <> 'ACTIVE' or o.department_id is distinct from m.department_id
        or not (o.role = 'DEPARTMENT_HEAD' or exists (select 1 from public.teams t where t.id = o.team_id and t.division::text = m.division)) then
    v_status := 'OUT_OF_SCOPE';
  end if;
  if v_status is not null and lk.customer_id is null then
    update public.crocodial_crm_lead_links set status = v_status, department_id = m.department_id, external_owner_ext = e.assigned_to_ext,
           external_owner_profile = m.profile_id, external_status = e.status, disposition = v_disp, last_external_update = e.external_updated_at,
           last_reconciled_at = now(), updated_at = now(),
           reason = case v_status when 'UNMAPPED_ASSIGNEE' then 'The Crocodial user it is assigned to has no approved mapping.'
                                  when 'OUT_OF_SCOPE' then 'The mapped person is inactive or not in this department''s Sales function.'
                                  else 'Lead import is off for this department.' end
     where id = lk.id;
    return v_status;
  end if;

  -- ---- an existing link: update it (a protected or overridden lead keeps its CRM data)
  if lk.customer_id is not null then
    select * into c from public.customers where id = lk.customer_id for update;
    if c.id is null then
      update public.crocodial_crm_lead_links set status = 'FAILED', customer_id = null, reason = 'The linked CRM record no longer exists.', updated_at = now() where id = lk.id;
      return 'FAILED';
    end if;
    if c.lifecycle_stage::text <> 'LEAD' then
      update public.crocodial_crm_lead_links set status = 'PROTECTED', external_owner_ext = e.assigned_to_ext, external_owner_profile = m.profile_id,
             external_status = e.status, disposition = v_disp, last_external_update = e.external_updated_at, last_reconciled_at = now(), updated_at = now(),
             reason = 'The CRM record is past the lead stage: Crocodial changes are not applied.'
       where id = lk.id;
      return 'UNCHANGED';
    end if;
    if not p_apply or v_status is not null then
      update public.crocodial_crm_lead_links set external_owner_ext = e.assigned_to_ext, external_owner_profile = m.profile_id, external_status = e.status,
             disposition = v_disp, last_external_update = e.external_updated_at, last_reconciled_at = now(), updated_at = now()
       where id = lk.id;
      return 'UNCHANGED';
    end if;
    -- a CRM user changed the owner since the last sync: the CRM keeps it from now on
    if lk.assignment_mode = 'EXTERNAL' and lk.applied_owner_id is not null and c.owner_id is distinct from lk.applied_owner_id then
      lk.assignment_mode := 'CRM_OVERRIDE';
    end if;
    v_local_newer := c.updated_at > coalesce(lk.last_applied_at, '-infinity'::timestamptz) + interval '2 seconds'
                     and (e.external_updated_at is null or c.updated_at > e.external_updated_at);
    perform set_config('app.suppress_lead_automations', 'on', true);
    if lk.assignment_mode = 'EXTERNAL' and c.owner_id is distinct from m.profile_id then
      update public.customers set owner_id = m.profile_id where id = c.id;
      insert into public.customer_activities (customer_id, actor_id, type, note)
      values (c.id, null, 'CROCODIAL_OWNER_CHANGED', 'Assigned in Crocodial to ' || o.full_name || ' (seen by the CRM sync; Crocodial does not say who assigned it)');
      v_result := 'UPDATED';
    end if;
    if not v_local_newer then
      -- a tag no longer usable in the lead's department (retired or narrowed since it was mapped) changes no tag, rather than failing the lead
      update public.customers
         set lead_tag_id = coalesce(case when private.lead_tag_usable(v_tag, department_id) then v_tag end, lead_tag_id),
             next_follow_up_at = coalesce(e.next_followup_at, next_follow_up_at)
       where id = c.id
         and (lead_tag_id is distinct from coalesce(case when private.lead_tag_usable(v_tag, department_id) then v_tag end, lead_tag_id)
              or (e.next_followup_at is not null and next_follow_up_at is distinct from e.next_followup_at));
      get diagnostics v_n = row_count;
      if v_n > 0 then v_result := 'UPDATED'; end if;
    end if;
    perform set_config('app.suppress_lead_automations', '', true);
    update public.crocodial_crm_lead_links set status = 'LINKED', assignment_mode = lk.assignment_mode, department_id = m.department_id,
           external_owner_ext = e.assigned_to_ext, external_owner_profile = m.profile_id,
           applied_owner_id = case when lk.assignment_mode = 'EXTERNAL' then m.profile_id else lk.applied_owner_id end,
           external_status = e.status, disposition = v_disp, last_external_update = e.external_updated_at, last_reconciled_at = now(),
           last_applied_at = case when v_result = 'UPDATED' then clock_timestamp() else lk.last_applied_at end,
           reason = case when lk.assignment_mode = 'CRM_OVERRIDE' and c.owner_id is distinct from m.profile_id then 'Owner changed in the CRM; Crocodial assigns it to ' || o.full_name || '.'
                         when v_tag is null and not v_ignored and e.status is not null then 'Unknown Crocodial status "' || left(e.status, 80) || '": no CRM status was changed.'
                         when v_local_newer then 'Edited in the CRM after the last Crocodial change: the CRM edit was kept.' end,
           updated_at = now()
     where id = lk.id;
    return v_result;
  end if;

  -- ---- no CRM record yet: find candidates in the same department (phone / e-mail are evidence, not identity)
  select coalesce(array_agg(x.id order by x.created_at), '{}') into v_cands
    from (select distinct cu.id, cu.created_at from public.customers cu
           where cu.department_id = m.department_id
             and ((private.croc_phone_key(e.phone_number) is not null and private.croc_phone_key(cu.phone) = private.croc_phone_key(e.phone_number))
                  or (e.email is not null and lower(cu.email) = e.email))
           limit 5) x;
  if cardinality(v_cands) > 1 then
    v_status := 'AMBIGUOUS';
  elsif cardinality(v_cands) = 1 then
    select * into c from public.customers where id = v_cands[1] for update;
    if exists (select 1 from public.crocodial_crm_lead_links x where x.customer_id = c.id and x.connection_id = p_connection and x.id <> lk.id) then
      v_status := 'AMBIGUOUS';
    elsif c.lifecycle_stage::text <> 'LEAD' then
      v_status := 'PROTECTED';
    elsif c.owner_id is distinct from m.profile_id then
      v_status := 'OWNER_CONFLICT';
    else
      v_status := case when p_apply then 'LINKED' else 'PENDING_LINK' end;
    end if;
  else
    v_status := case when p_apply then 'LINKED' else 'PENDING_CREATE' end;
  end if;

  if p_apply and v_status = 'LINKED' and cardinality(v_cands) = 0 then
    perform set_config('app.suppress_lead_automations', 'on', true);
    if not private.lead_tag_usable(v_tag, m.department_id) then v_tag := private.lead_tag_seed('NEW'); end if;
    insert into public.customers (owner_id, lifecycle_stage, lead_tag_id, lead_status, name, company, phone, email, lead_source, call_status, next_follow_up_at)
    values (m.profile_id, 'LEAD', v_tag, (select t.stage from public.lead_tags t where t.id = v_tag),
            left(coalesce(nullif(btrim(e.name), ''), nullif(btrim(e.company), ''), e.phone_number, 'Crocodial lead ' || e.external_id), 200),
            e.company, e.phone_number, e.email, 'Crocodial', 'PENDING', e.next_followup_at)
    returning id into v_new;
    insert into public.customer_activities (customer_id, actor_id, type, note)
    values (v_new, null, 'CROCODIAL_IMPORTED', 'Imported from Crocodial (lead ' || e.external_id || '), assigned there to ' || o.full_name || '. No welcome message was sent.');
    perform set_config('app.suppress_lead_automations', '', true);
    v_result := 'CREATED';
  end if;
  update public.crocodial_crm_lead_links
     set status = v_status,
         customer_id = case when v_new is not null then v_new when v_status in ('LINKED', 'PROTECTED') and p_apply then v_cands[1] end,
         import_source = case when v_new is not null then 'CREATED' when v_status in ('LINKED', 'PROTECTED') and p_apply then 'MATCHED' end,
         candidate_ids = v_cands, department_id = m.department_id, external_owner_ext = e.assigned_to_ext, external_owner_profile = m.profile_id,
         applied_owner_id = case when v_status = 'LINKED' and p_apply then m.profile_id end,
         external_status = e.status, disposition = v_disp, last_external_update = e.external_updated_at, last_reconciled_at = now(),
         last_applied_at = case when v_new is not null then clock_timestamp() end,
         reason = case v_status
           when 'AMBIGUOUS' then 'Several CRM records of this department have the same phone number or e-mail.'
           when 'PROTECTED' then 'An existing CRM record past the lead stage has the same phone or e-mail: linked for reference, never changed.'
           when 'OWNER_CONFLICT' then 'An existing lead with the same phone or e-mail belongs to another CRM owner.'
           when 'PENDING_CREATE' then 'Preview: a new lead would be created for ' || o.full_name || '.'
           when 'PENDING_LINK' then 'Preview: it would be linked to the existing lead with the same phone or e-mail.'
           else null end,
         updated_at = now()
   where id = lk.id;
  if v_result = 'UNCHANGED' and v_status = 'LINKED' and p_apply then v_result := 'UPDATED'; end if;
  return case when v_status in ('LINKED', 'PENDING_CREATE', 'PENDING_LINK') then v_result else v_status end;
end $$;
revoke all on function private.croc_reconcile_one(uuid, bigint, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. The monitor (copied from 20270304000100): the mapping rows carry the tag and Ignore; a mapping with neither (reset by a new
--    department link) is not a mapping: its status is listed as unknown again
-- ---------------------------------------------------------------------------
create or replace function public.croc_reconcile_overview(p_connection uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return jsonb_build_object(
    'departments', coalesce((select jsonb_agg(jsonb_build_object('departmentId', l.department_id, 'name', d.name, 'enabled', l.enabled, 'leadImport', l.lead_import) order by d.name)
                               from public.crocodial_department_links l join public.departments d on d.id = l.department_id
                              where l.connection_id = p_connection and l.division = 'SALES'), '[]'::jsonb),
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.crocodial_crm_lead_links where connection_id = p_connection group by status) q), '{}'::jsonb),
    'ownershipDiffers', (select count(*) from public.crocodial_crm_lead_links k join public.customers c on c.id = k.customer_id
                          where k.connection_id = p_connection and k.assignment_mode = 'CRM_OVERRIDE' and c.owner_id is distinct from k.external_owner_profile),
    'externalLeads', (select count(*) from public.crocodial_ext_leads where connection_id = p_connection),
    'missingAtSource', (select count(*) from public.crocodial_ext_leads where connection_id = p_connection and missing_since is not null),
    'unknownStatuses', coalesce((select jsonb_agg(jsonb_build_object('status', s, 'leads', n) order by n desc) from (
         select lower(btrim(e.status)) s, count(*) n from public.crocodial_ext_leads e
          where e.connection_id = p_connection and e.status is not null and btrim(e.status) <> ''
            and not exists (select 1 from public.crocodial_status_mappings m where m.connection_id = e.connection_id and m.external_status = lower(btrim(e.status))
                              and (m.tag_id is not null or m.ignored))
          group by 1 order by 2 desc limit 50) q), '[]'::jsonb),
    'mappings', coalesce((select jsonb_agg(jsonb_build_object('status', external_status, 'disposition', disposition, 'tagId', tag_id, 'ignored', ignored) order by external_status)
                            from public.crocodial_status_mappings where connection_id = p_connection and (tag_id is not null or ignored)), '[]'::jsonb),
    'unmappedAssignees', coalesce((select jsonb_agg(jsonb_build_object('externalId', q.ext, 'name', (select x.name from public.crocodial_ext_employees x where x.connection_id = p_connection and x.external_id = q.ext), 'leads', q.n) order by q.n desc) from (
         select e.assigned_to_ext ext, count(*) n from public.crocodial_ext_leads e
          where e.connection_id = p_connection and e.assigned_to_ext is not null
            and not exists (select 1 from public.crocodial_employee_mappings m where m.connection_id = e.connection_id and m.external_employee_id = e.assigned_to_ext and m.status = 'APPROVED' and m.ended_at is null)
          group by 1 order by 2 desc limit 50) q), '[]'::jsonb),
    'reconcile', (select to_jsonb(s) - 'connection_id' from public.crocodial_reconcile_state s where s.connection_id = p_connection),
    'resources', coalesce((select jsonb_agg(jsonb_build_object('resource', s.resource, 'lastOkAt', s.last_ok_at, 'lastRunAt', s.last_run_at, 'lastError', s.last_error,
                                                            'rowsLastRun', s.rows_last_run, 'inProgress', s.next_page is not null) order by s.resource)
                             from public.crocodial_sync_state s where s.connection_id = p_connection), '[]'::jsonb),
    'recentRuns', coalesce((select jsonb_agg(jsonb_build_object('resource', r.resource, 'outcome', r.outcome, 'rows', r.rows_stored, 'pages', r.pages, 'finishedAt', r.finished_at,
                                                             'seconds', round(extract(epoch from r.finished_at - r.started_at)::numeric, 1), 'error', r.error,
                                                             'rateLimited', coalesce(r.error ilike '%429%' or r.error ilike '%rate%', false)) order by r.finished_at desc)
                              from (select * from public.crocodial_sync_runs where connection_id = p_connection order by finished_at desc limit 20) r), '[]'::jsonb));
end $$;
revoke all on function public.croc_reconcile_overview(uuid) from public, anon;
grant execute on function public.croc_reconcile_overview(uuid) to authenticated;

notify pgrst, 'reload schema';
