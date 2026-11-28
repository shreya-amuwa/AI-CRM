-- =============================================================================
-- CEO-managed Crocodial connections, part 1: who may manage a connection (enforced here, not in the browser).
-- docs/superpowers/specs/2026-11-27-lead-tags-and-ceo-crocodial-connections-design.md, "Part 3", "Rollout and switching on", "Who manages
-- a connection". Run after 20270306000100_crocodial_status_tags.sql.
--
-- Rules:
--  * The Managing Director (Super Admin) manages every connection, as before.
--  * A CEO manages a connection only when they run EVERY department linked to it (private.is_ceo_for_sales: an active CEO whose scope
--    covers that department's Sales side), and it has at least one link: private.croc_can_manage / private.croc_require_manager.
--    Everything else is refused with "FORBIDDEN: You can manage Crocodial only for departments you run." (a connection or mapping
--    that does not exist is refused the same way, so nothing is revealed). A plain Department Head or a Support-only CEO manages nothing.
--  * The configuration functions check croc_require_manager(<the connection>) instead of the Super Admin: the connection itself
--    (croc_admin_connection, croc_sync_request), its people mappings (check / create / approve / revoke / count-from: only ACTIVE
--    employees of the connection's linked departments), its status mappings, lead import, held leads (linked only to records of a linked
--    department) and the monitor (croc_reconcile_overview, which is also the check of the server's "Reconcile now"; the batches,
--    public.croc_reconcile, stay with the service role and are not callable by a signed-in user).
--  * croc_admin_overview: the MD gets everything as before; a CEO gets only the connections they manage (their links, mappings,
--    Crocodial users and branches, audit), no rollout table, and `departments` limited to the ones they run. Each connection lists
--    `managedBy` (the CEOs who could manage it).
--  * croc_connection_save: a CEO cannot use a server credential name (credential_ref is now optional; Task 8 stores keys); a CEO creating
--    a connection names the departments (departmentIds, at least one, each one they run): the connection, its Sales links and the
--    rollout of those departments are created in the same transaction (the rollout is audited as done by that CEO).
--    croc_department_link_save: the manager of the connection, for a department they run (Sales only); the rollout is allowed
--    automatically. croc_rollout_set stays with the MD.
--  * The MD's kill switch: the MD switching a connection or a link off records md_disabled_at; while it is set, nobody but the MD can
--    switch it on again ("CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on."). The MD
--    switching it on clears it. A rollout the MD withdrew (crocodial_rollout.allowed = false) is not allowed again by a CEO (same copy).
--    The MD saving a connection or link OFF records it even when it is already off (so the MD can block one a CEO switched off); saving it
--    off again keeps the first time.
--    The MD's switch-off is a stop for every DEPARTMENT the connection or link serves (private.croc_md_blocked), not only for that item:
--    while it is set, a non-MD cannot create a connection for such a department, add a link for it (to any connection), switch on a
--    link for it, or switch on a connection with a link switched on for it; and cannot store or clear the key of a connection the MD
--    switched off (croc_token_store / croc_token_clear: the key cannot be freed and reused on a new connection). Same CONFLICT copy. The
--    MD switching the connection or link back on lifts it.
--  * croc_mapping_candidates: who can be chosen when mapping people (the manager of the connection, a department linked to it): the
--    ACTIVE people of that department that croc_mapping_create would accept. The users list is not used for this: a CEO can read profiles
--    only of their home department there (private.can_view_profile), not of every department they run.
--  * The write paths (croc_connection_save on an existing connection, croc_department_link_save, croc_token_store, croc_token_clear) lock
--    the connection row BEFORE checking the manager, so two CEOs changing its links at the same time cannot both pass the check.
--  * Stored Crocodial keys ("Token storage", "Encryption key lifetime"): the server encrypts the key (AES-256-GCM with
--    AUTOMATION_SECRET_KEY, "v1:" format) after one live read proved it works; the database keeps only the ciphertext, a sha256 fingerprint
--    (one active connection per Crocodial account: "CONFLICT: This Crocodial account is already connected (by another department)."), the
--    last 4 characters, who and when. croc_token_store / croc_token_clear / croc_token_ciphertext / croc_sync_due are the service role's;
--    the server first checks the signed-in user with croc_can_manage_check, and store / clear check the actor again under the row lock.
--    Overviews show keySource (DATABASE, SERVER_SETTING or NONE) and keyLast4, never the ciphertext or the fingerprint; the audit gets the
--    last 4 only. A stored key comes before the server setting. Health KEY_UNREADABLE: a stored key the server can no longer decrypt
--    (AUTOMATION_SECRET_KEY changed); the sync skips it and the manager is asked to enter the key again.
-- Additive and safe to run twice; pasteable in the SQL editor. Nothing is deleted. Every change is audited.
--
-- Rollback: re-run the definitions this file replaces from their earlier migrations (croc_connection_json, croc_admin_overview,
-- croc_connection_save, croc_department_link_save, croc_mapping_check, croc_mapping_create, croc_mapping_approve, croc_mapping_revoke,
-- croc_admin_connection: 20270115000100; croc_sync_request: 20270115000500; croc_mapping_count_from: 20270116000300; croc_lead_import_set,
-- croc_lead_links_list, croc_lead_link_resolve: 20270304000100; croc_status_mapping_tag_set, croc_reconcile_overview: 20270306000100), then:
--   drop function if exists public.croc_mapping_candidates(uuid, uuid);
--   drop function if exists private.croc_md_blocked(uuid);
--   drop function if exists private.croc_rollout_auto(uuid, uuid, boolean);
--   drop function if exists private.croc_managed_by(uuid);
--   drop function if exists private.croc_may_link(uuid);
--   drop function if exists private.croc_is_ceo();
--   drop function if exists private.croc_require_manager(uuid);
--   drop function if exists private.croc_can_manage(uuid);
--   drop function if exists private.croc_ceo_runs(uuid, uuid);
--   drop function if exists public.croc_token_store(uuid, text, text, text, uuid);
--   drop function if exists public.croc_token_clear(uuid, uuid);
--   drop function if exists public.croc_token_ciphertext(uuid);
--   drop function if exists public.croc_can_manage_check(uuid);
--   drop function if exists private.croc_actor_require_manager(uuid, uuid);
--   (croc_sync_due: 20270204000100; croc_connection_status: 20270115000100, after setting any KEY_UNREADABLE health back to 'UNKNOWN')
-- The md_disabled_at and token_* columns can stay (clear token_ciphertext to stop using stored keys). credential_ref can be made required again only once every connection has one:
--   alter table public.crocodial_connections alter column credential_ref set not null;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
-- when the MD switched it off (null: not switched off by the MD); only the MD can switch it on while this is set
alter table public.crocodial_connections add column if not exists md_disabled_at timestamptz;
alter table public.crocodial_department_links add column if not exists md_disabled_at timestamptz;
-- a connection created by a CEO has no server setting (its key is stored by the server, Task 8); still one connection per name when set
alter table public.crocodial_connections alter column credential_ref drop not null;
-- a key stored by the server (encrypted there; the plain key never reaches the database)
alter table public.crocodial_connections add column if not exists token_ciphertext text;
alter table public.crocodial_connections add column if not exists token_fingerprint text;
alter table public.crocodial_connections add column if not exists token_last4 text;
alter table public.crocodial_connections add column if not exists token_set_by uuid references public.profiles(id) on delete set null;
alter table public.crocodial_connections add column if not exists token_set_at timestamptz;
-- one connection per Crocodial account (a removed key is cleared, so the account can be connected again)
create unique index if not exists crocodial_connections_token_fingerprint_key on public.crocodial_connections (token_fingerprint) where token_fingerprint is not null;
-- KEY_UNREADABLE: a stored key the server can no longer decrypt
alter table public.crocodial_connections drop constraint if exists crocodial_connections_health_check;
alter table public.crocodial_connections add constraint crocodial_connections_health_check
  check (health in ('UNKNOWN', 'OK', 'NO_CREDENTIAL', 'AUTH_FAILED', 'DISABLED_AT_SOURCE', 'RATE_LIMITED', 'ERROR', 'KEY_UNREADABLE'));

-- ---------------------------------------------------------------------------
-- 2. Who manages a connection
-- ---------------------------------------------------------------------------
-- p_profile runs p_department for leads (private.is_ceo_for_sales, for any profile): an active CEO whose scope covers its Sales side
create or replace function private.croc_ceo_runs(p_profile uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                  where p.id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head)
     and private.scope_covers(p_profile, p_department, 'SALES')
$$;
revoke all on function private.croc_ceo_runs(uuid, uuid) from public, anon, authenticated;

-- the caller manages the connection: the MD, or a CEO who runs every department linked to it (at least one link)
create or replace function private.croc_can_manage(p_connection uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_super_admin(), false)
      or (exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection)
          and not exists (select 1 from public.crocodial_department_links l
                           where l.connection_id = p_connection and not coalesce(private.is_ceo_for_sales(l.department_id), false)))
$$;
revoke all on function private.croc_can_manage(uuid) from public, anon;
grant execute on function private.croc_can_manage(uuid) to authenticated, service_role;

create or replace function private.croc_require_manager(p_connection uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.croc_can_manage(p_connection), false) then
    raise exception 'FORBIDDEN: You can manage Crocodial only for departments you run.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.croc_require_manager(uuid) from public, anon, authenticated;

-- the caller is a CEO who runs at least one department's Sales side (may create connections and read their own overview)
create or replace function private.croc_is_ceo()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.departments d where private.is_ceo_for_sales(d.id))
$$;
revoke all on function private.croc_is_ceo() from public, anon, authenticated;

-- a department a CEO may link: one they run (not a Support facet)
create or replace function private.croc_may_link(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.departments d where d.id = p_department and coalesce(d.facet_division, 'SALES') = 'SALES')
     and coalesce(private.is_ceo_for_sales(p_department), false)
$$;
revoke all on function private.croc_may_link(uuid) from public, anon, authenticated;

-- the CEOs who could manage the connection (shown to the MD as "Managed by")
create or replace function private.croc_managed_by(p_connection uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name, p.id), '[]'::jsonb)
    from public.profiles p
   where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head
     and exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection)
     and not exists (select 1 from public.crocodial_department_links l
                      where l.connection_id = p_connection and not private.croc_ceo_runs(p.id, l.department_id))
$$;
revoke all on function private.croc_managed_by(uuid) from public, anon, authenticated;

-- A CEO linking p_department: its Sales rollout is allowed automatically (audited as done by that CEO). A rollout the MD withdrew is
-- not allowed again: refused when p_required (a new link, or switching one on), left as it is otherwise.
create or replace function private.croc_rollout_auto(p_department uuid, p_connection uuid, p_required boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_allowed boolean;
begin
  select allowed into v_allowed from public.crocodial_rollout where department_id = p_department and division = 'SALES' for update;
  if v_allowed then
    return;
  end if;
  if v_allowed is not null then
    if p_required then
      raise exception 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.' using errcode = 'P0001';
    end if;
    return;
  end if;
  insert into public.crocodial_rollout (department_id, division, allowed, note, updated_by, updated_at)
  values (p_department, 'SALES', true, 'Allowed when a CEO linked a connection', auth.uid(), now())
  on conflict (department_id, division) do nothing;
  if found then
    perform private.write_audit('CROCODIAL_ROLLOUT_SET', 'crocodial_rollout', p_department, p_department, null,
      jsonb_build_object('division', 'SALES', 'before', null, 'after', true, 'automatic', true, 'connectionId', p_connection));
  end if;
end $$;
revoke all on function private.croc_rollout_auto(uuid, uuid, boolean) from public, anon, authenticated;

-- The MD's switch-off stops a department: some connection serving it, or one of its links, was switched off by the MD (and not switched on
-- again). A non-MD then cannot start Crocodial for that department another way (a new connection, a new or switched-on link, switching on
-- another connection that serves it).
create or replace function private.croc_md_blocked(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crocodial_department_links l join public.crocodial_connections c on c.id = l.connection_id
                  where l.department_id = p_department and (l.md_disabled_at is not null or c.md_disabled_at is not null))
$$;
revoke all on function private.croc_md_blocked(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The overview and the configuration (copied from 20270115000100; the guard and what is listed above change)
-- ---------------------------------------------------------------------------
create or replace function private.croc_connection_json(c public.crocodial_connections)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'externalAccountLabel', c.external_account_label, 'credentialRef', c.credential_ref,
    'enabled', c.enabled, 'health', c.health, 'lastError', c.last_error, 'lastAttemptAt', c.last_attempt_at, 'lastSuccessAt', c.last_success_at,
    'timezone', c.timezone, 'createdAt', c.created_at, 'updatedAt', c.updated_at, 'mdDisabledAt', c.md_disabled_at,
    -- where the key comes from (a stored key first) and its last 4 characters; never the ciphertext or the fingerprint
    'keySource', case when c.token_ciphertext is not null then 'DATABASE' when c.credential_ref is not null then 'SERVER_SETTING' else 'NONE' end,
    'keyLast4', case when c.token_ciphertext is not null then c.token_last4 end)
$$;
revoke all on function private.croc_connection_json(public.crocodial_connections) from public, anon, authenticated;

create or replace function public.croc_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_md boolean := coalesce(private.is_super_admin(), false);
  v_conns uuid[];
begin
  if not v_md and not private.croc_is_ceo() then
    raise exception 'FORBIDDEN: You can manage Crocodial only for departments you run.' using errcode = '42501';
  end if;
  -- the MD: every connection; a CEO: the ones they manage
  select coalesce(array_agg(c.id), '{}') into v_conns from public.crocodial_connections c where v_md or private.croc_can_manage(c.id);
  return jsonb_build_object(
    'rollout', case when v_md then coalesce((select jsonb_agg(jsonb_build_object('departmentId', r.department_id, 'departmentName', d.name, 'departmentSlug', d.slug,
                  'division', r.division, 'allowed', r.allowed, 'note', r.note, 'updatedAt', r.updated_at) order by d.name)
                from public.crocodial_rollout r join public.departments d on d.id = r.department_id), '[]'::jsonb) else '[]'::jsonb end,
    -- the departments a connection may be linked to: for a CEO, the ones they run
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug) order by d.name)
                from public.departments d where coalesce(d.facet_division, 'SALES') = 'SALES' and (v_md or private.croc_may_link(d.id))), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(private.croc_connection_json(c) || jsonb_build_object('managedBy', private.croc_managed_by(c.id)) order by c.created_at)
                from public.crocodial_connections c where c.id = any (v_conns)), '[]'::jsonb),
    'departmentLinks', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'connectionId', l.connection_id, 'departmentId', l.department_id,
                  'departmentName', d.name, 'division', l.division, 'enabled', l.enabled, 'stage', l.stage, 'updatedAt', l.updated_at,
                  'mdDisabledAt', l.md_disabled_at) order by d.name)
                from public.crocodial_department_links l join public.departments d on d.id = l.department_id where l.connection_id = any (v_conns)), '[]'::jsonb),
    'mappings', coalesce((select jsonb_agg(private.croc_mapping_json(m) order by m.created_at desc) from public.crocodial_employee_mappings m
                where m.connection_id = any (v_conns)), '[]'::jsonb),
    'externalEmployees', coalesce((select jsonb_agg(jsonb_build_object('connectionId', e.connection_id, 'externalId', e.external_id, 'name', e.name,
                  'isActive', e.is_active, 'branchIds', e.branch_ids, 'lastSeenAt', e.last_seen_at, 'missingSince', e.missing_since,
                  'mappingStatus', (select m.status from public.crocodial_employee_mappings m
                                     where m.connection_id = e.connection_id and m.external_employee_id = e.external_id and m.status in ('PENDING', 'APPROVED') limit 1))
                  order by e.name) from public.crocodial_ext_employees e where e.connection_id = any (v_conns)), '[]'::jsonb),
    'externalBranches', coalesce((select jsonb_agg(jsonb_build_object('connectionId', b.connection_id, 'externalId', b.external_id, 'name', b.name,
                  'status', b.status, 'missingSince', b.missing_since) order by b.name) from public.crocodial_ext_branches b where b.connection_id = any (v_conns)), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(x order by (x ->> 'at') desc) from (
                select jsonb_build_object('at', a.created_at, 'action', a.action, 'actorName', p.full_name, 'entityId', a.entity_id, 'metadata', a.metadata) as x
                  from public.audit_logs a left join public.profiles p on p.id = a.actor_id
                 where a.entity_type like 'crocodial%'
                   and (v_md
                        or (a.entity_type = 'crocodial_connection' and a.entity_id = any (v_conns))
                        or (a.entity_type = 'crocodial_department_link'
                            and a.entity_id in (select l.id from public.crocodial_department_links l where l.connection_id = any (v_conns)))
                        or (a.entity_type = 'crocodial_mapping'
                            and a.entity_id in (select m.id from public.crocodial_employee_mappings m where m.connection_id = any (v_conns)))
                        or (a.entity_type = 'crocodial_lead_link'
                            and a.entity_id in (select k.id from public.crocodial_crm_lead_links k where k.connection_id = any (v_conns))))
                 order by a.created_at desc limit 50) s), '[]'::jsonb)
  );
end $$;

create or replace function public.croc_connection_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := private.try_uuid(p ->> 'id');
  c public.crocodial_connections;
  v_old public.crocodial_connections;
  v_before jsonb;
  v_ref text := nullif(upper(btrim(coalesce(p ->> 'credentialRef', ''))), '');
  v_md boolean := coalesce(private.is_super_admin(), false);
  v_enabled boolean := (p ->> 'enabled')::boolean;
  v_depts uuid[];
  v_dept uuid;
  l public.crocodial_department_links;
begin
  if v_id is not null then
    -- the row is locked before the check: a concurrent change of its links waits, and the check sees it
    select * into v_old from public.crocodial_connections x where x.id = v_id for update;
    perform private.croc_require_manager(v_id);
  elsif not v_md and not private.croc_is_ceo() then
    raise exception 'FORBIDDEN: You can manage Crocodial only for departments you run.' using errcode = '42501';
  end if;
  if not v_md and v_ref is not null then
    raise exception 'FORBIDDEN: Only the Super Admin can use a server setting for the Crocodial key.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p ->> 'name', ''))) < 2 then
    raise exception 'VALIDATION_ERROR: Give the connection a name.' using errcode = '22023';
  end if;
  if v_ref is not null and v_ref !~ '^CROCODIAL_TOKEN_[A-Z0-9_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: The credential is the NAME of the server setting that holds the token, like CROCODIAL_TOKEN_MPILLAR (never the token itself).' using errcode = '22023';
  end if;
  if v_id is null then
    -- a CEO names the departments (at least one, each one they run)
    if not v_md then
      if jsonb_typeof(p -> 'departmentIds') is distinct from 'array' or jsonb_array_length(p -> 'departmentIds') = 0 then
        raise exception 'VALIDATION_ERROR: Choose at least one department you run.' using errcode = '22023';
      end if;
      select array_agg(distinct private.try_uuid(x)) into v_depts from jsonb_array_elements_text(p -> 'departmentIds') x;
      if array_position(v_depts, null) is not null or exists (select 1 from unnest(v_depts) d where not private.croc_may_link(d)) then
        raise exception 'FORBIDDEN: You can manage Crocodial only for departments you run.' using errcode = '42501';
      end if;
      -- not for a department the MD stopped (a new connection is no way around the MD's switch-off)
      if exists (select 1 from unnest(v_depts) d where private.croc_md_blocked(d)) then
        raise exception 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.' using errcode = 'P0001';
      end if;
    end if;
    insert into public.crocodial_connections (name, external_account_label, credential_ref, enabled, created_by)
    values (btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'externalAccountLabel', '')), ''), v_ref, coalesce(v_enabled, false), auth.uid())
    returning * into c;
    -- the CEO's departments: their Sales links (on when the connection is) and the rollout, in the same transaction
    foreach v_dept in array coalesce(v_depts, '{}') loop
      perform private.croc_rollout_auto(v_dept, c.id, true);
      insert into public.crocodial_department_links (connection_id, department_id, division, enabled, stage, owner_id)
      values (c.id, v_dept, 'SALES', c.enabled, 'PILOT', auth.uid())
      returning * into l;
      perform private.write_audit('CROCODIAL_DEPARTMENT_LINK_SAVED', 'crocodial_department_link', l.id, v_dept, null,
        jsonb_build_object('connectionId', c.id, 'division', 'SALES', 'before', null, 'after', to_jsonb(l)));
    end loop;
  else
    if v_old.id is null then
      raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
    end if;
    v_before := private.croc_connection_json(v_old);
    -- the MD's kill switch: only the MD switches on what the MD switched off
    if not v_md and v_enabled and v_old.md_disabled_at is not null then
      raise exception 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.' using errcode = 'P0001';
    end if;
    -- nor switch on a connection that would serve (a link switched on) a department the MD stopped
    if not v_md and v_enabled and not v_old.enabled
       and exists (select 1 from public.crocodial_department_links x where x.connection_id = v_id and x.enabled and private.croc_md_blocked(x.department_id)) then
      raise exception 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.' using errcode = 'P0001';
    end if;
    update public.crocodial_connections set name = btrim(p ->> 'name'),
           external_account_label = nullif(btrim(coalesce(p ->> 'externalAccountLabel', '')), ''),
           -- only the MD sets the server credential name (left as it is when none is given)
           credential_ref = case when v_md then coalesce(v_ref, credential_ref) else credential_ref end,
           enabled = coalesce(v_enabled, enabled),
           -- the MD saving it off records it, also when it is already off (the first time is kept)
           md_disabled_at = case when v_md and v_enabled then null
                                 when v_md and not v_enabled then coalesce(md_disabled_at, now())
                                 else md_disabled_at end,
           health = case when v_md and v_ref is not null and credential_ref is distinct from v_ref then 'UNKNOWN' else health end, updated_at = now()
     where id = v_id returning * into c;
  end if;
  perform private.write_audit(case when v_id is null then 'CROCODIAL_CONNECTION_CREATED' else 'CROCODIAL_CONNECTION_UPDATED' end,
    'crocodial_connection', c.id, null, null, jsonb_build_object('before', v_before, 'after', private.croc_connection_json(c)));
  return private.croc_connection_json(c);
exception when unique_violation then
  raise exception 'CONFLICT: Another connection already uses that credential name.' using errcode = 'P0001';
end $$;

create or replace function public.croc_department_link_save(p_connection uuid, p_department uuid, p_division text, p_enabled boolean,
  p_stage text default 'PILOT')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.crocodial_department_links;
  v_old public.crocodial_department_links;
  v_before jsonb;
  v_md boolean := coalesce(private.is_super_admin(), false);
begin
  -- the connection row is locked before the check: two CEOs adding links at the same time are checked one after the other
  perform 1 from public.crocodial_connections where id = p_connection for update;
  if not v_md then
    -- the manager of the connection, for a department they run, Sales only
    perform private.croc_require_manager(p_connection);
    if p_division is distinct from 'SALES' then
      raise exception 'VALIDATION_ERROR: Crocodial is available for Sales only.' using errcode = '22023';
    end if;
    if not private.croc_may_link(p_department) then
      raise exception 'FORBIDDEN: You can manage Crocodial only for departments you run.' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from public.crocodial_connections where id = p_connection) then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  if p_stage not in ('PILOT', 'PRODUCTION') then
    raise exception 'VALIDATION_ERROR: Unknown stage.' using errcode = '22023';
  end if;
  select * into v_old from public.crocodial_department_links x
   where x.connection_id = p_connection and x.department_id = p_department and x.division = p_division for update;
  if v_md then
    if not exists (select 1 from public.crocodial_rollout r where r.department_id = p_department and r.division = p_division and r.allowed) then
      raise exception 'FORBIDDEN: Crocodial is not rolled out to this department and function. Allow it in the rollout first.' using errcode = '42501';
    end if;
  else
    -- the rollout is allowed automatically (never one the MD withdrew)
    perform private.croc_rollout_auto(p_department, p_connection, v_old.id is null or coalesce(p_enabled, false));
    if coalesce(p_enabled, false) and v_old.md_disabled_at is not null then
      raise exception 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.' using errcode = 'P0001';
    end if;
    -- a department the MD stopped: no new link for it, and no link switched on for it (on any connection)
    if (v_old.id is null or coalesce(p_enabled, false)) and private.croc_md_blocked(p_department) then
      raise exception 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.' using errcode = 'P0001';
    end if;
  end if;
  if v_old.id is not null then
    v_before := to_jsonb(v_old);
  end if;
  insert into public.crocodial_department_links (connection_id, department_id, division, enabled, stage, owner_id)
  values (p_connection, p_department, p_division, coalesce(p_enabled, false), p_stage, auth.uid())
  on conflict (connection_id, department_id, division) do update set enabled = excluded.enabled, stage = excluded.stage, updated_at = now(),
    -- the MD switching a link off is recorded; the MD switching it on clears it
    md_disabled_at = case when v_md and excluded.enabled then null
                          when v_md and not excluded.enabled then coalesce(public.crocodial_department_links.md_disabled_at, now())
                          else public.crocodial_department_links.md_disabled_at end
  returning * into l;
  perform private.write_audit('CROCODIAL_DEPARTMENT_LINK_SAVED', 'crocodial_department_link', l.id, p_department, null,
    jsonb_build_object('connectionId', p_connection, 'division', p_division, 'before', v_before, 'after', to_jsonb(l)));
  return jsonb_build_object('id', l.id, 'connectionId', l.connection_id, 'departmentId', l.department_id, 'division', l.division,
    'enabled', l.enabled, 'stage', l.stage, 'mdDisabledAt', l.md_disabled_at);
end $$;

-- ---------------------------------------------------------------------------
-- 4. The connection's settings, people, statuses, leads and monitor: the manager of the connection (copied from their latest
--    definitions, named above each; only the guard changes, and what is noted)
-- ---------------------------------------------------------------------------
-- croc_mapping_check (from 20270115000100; a CEO is also refused an employee outside the connection's departments)
create or replace function public.croc_mapping_check(p_connection uuid, p_external_employee bigint, p_profile uuid, p_department uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.croc_require_manager(p_connection);
  -- a CEO is shown only employees of the connection's departments (the MD: anyone, as before)
  if not coalesce(private.is_super_admin(), false)
     and not exists (select 1 from public.profiles p join public.crocodial_department_links l on l.connection_id = p_connection and l.department_id = p.department_id
                      where p.id = p_profile) then
    raise exception 'VALIDATION_ERROR: Choose an employee of this connection''s departments.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'profile', private.croc_profile_check(p_profile, p_department, 'SALES'),
    'externalEmployee', (select jsonb_build_object('externalId', e.external_id, 'name', e.name, 'isActive', e.is_active)
                           from public.crocodial_ext_employees e where e.connection_id = p_connection and e.external_id = p_external_employee),
    'externalAlreadyMapped', exists (select 1 from public.crocodial_employee_mappings m where m.connection_id = p_connection
                                       and m.external_employee_id = p_external_employee and m.status in ('PENDING', 'APPROVED')),
    'profileAlreadyMapped', exists (select 1 from public.crocodial_employee_mappings m where m.connection_id = p_connection
                                      and m.profile_id = p_profile and m.status in ('PENDING', 'APPROVED')),
    'departmentLinked', exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection
                                  and l.department_id = p_department and l.division = 'SALES'));
end $$;


-- croc_mapping_create (from 20270115000100; and only an ACTIVE employee of a linked department)
create or replace function public.croc_mapping_create(p_connection uuid, p_external_employee bigint, p_profile uuid, p_department uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_check jsonb;
  e public.crocodial_ext_employees;
  m public.crocodial_employee_mappings;
begin
  perform private.croc_require_manager(p_connection);
  select * into e from public.crocodial_ext_employees where connection_id = p_connection and external_id = p_external_employee;
  if e.external_id is null then
    raise exception 'NOT_FOUND: That Crocodial user is not in this account''s employee list. Test the connection to refresh the list.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection and l.department_id = p_department and l.division = 'SALES') then
    raise exception 'VALIDATION_ERROR: Link this connection to the department''s Sales first.' using errcode = '22023';
  end if;
  v_check := private.croc_profile_check(p_profile, p_department, 'SALES');
  if v_check is null then
    raise exception 'NOT_FOUND: CRM employee not found.' using errcode = 'P0002';
  end if;
  -- only an active employee of one of the connection's linked departments
  if not exists (select 1 from public.profiles p join public.crocodial_department_links l on l.connection_id = p_connection and l.department_id = p.department_id
                  where p.id = p_profile and p.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: Choose an employee of this connection''s departments.' using errcode = '22023';
  end if;
  if not (v_check ->> 'eligible')::boolean then
    raise exception 'VALIDATION_ERROR: % is not an active member of this department''s Sales.', v_check ->> 'name' using errcode = '22023';
  end if;
  insert into public.crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division,
                                                  role_snapshot, status, proposed_by)
  values (p_connection, p_external_employee, e.name, p_profile, p_department, 'SALES',
          jsonb_build_object('role', v_check ->> 'role', 'salesSubRole', v_check ->> 'salesSubRole', 'teamId', v_check ->> 'teamId',
                             'teamName', v_check ->> 'teamName'), 'PENDING', auth.uid())
  returning * into m;
  perform private.write_audit('CROCODIAL_MAPPING_PROPOSED', 'crocodial_mapping', m.id, p_department, (v_check ->> 'teamId')::uuid,
    jsonb_build_object('connectionId', p_connection, 'externalEmployeeId', p_external_employee, 'externalName', e.name, 'profileId', p_profile));
  return private.croc_mapping_json(m);
exception when unique_violation then
  raise exception 'CONFLICT: This Crocodial user or this CRM employee already has a mapping on this connection. Revoke it first.' using errcode = 'P0001';
end $$;

-- Who can be chosen when mapping people of a linked department: its ACTIVE people that croc_mapping_create accepts (croc_profile_check
-- eligible: in that department, its Sales side, not the Super Admin). The manager of the connection only.
create or replace function public.croc_mapping_candidates(p_connection uuid, p_department uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.croc_require_manager(p_connection);
  if not exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection and l.department_id = p_department and l.division = 'SALES') then
    raise exception 'VALIDATION_ERROR: Link this connection to the department''s Sales first.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'fullName', p.full_name, 'email', p.email, 'role', p.role,
                     'salesSubRole', p.sales_sub_role, 'teamName', t.name) order by p.full_name, p.id)
                     from public.profiles p left join public.teams t on t.id = p.team_id
                    where p.department_id = p_department and p.status = 'ACTIVE'
                      and coalesce((private.croc_profile_check(p.id, p_department, 'SALES') ->> 'eligible')::boolean, false)), '[]'::jsonb);
end $$;

-- croc_mapping_approve (from 20270115000100; the connection through the mapping)
create or replace function public.croc_mapping_approve(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.crocodial_employee_mappings;
  v_check jsonb;
begin
  perform private.croc_require_manager((select x.connection_id from public.crocodial_employee_mappings x where x.id = p_id));
  select * into m from public.crocodial_employee_mappings where id = p_id for update;
  if m.id is null then
    raise exception 'NOT_FOUND: Mapping not found.' using errcode = 'P0002';
  end if;
  if m.status <> 'PENDING' then
    raise exception 'CONFLICT: Only a pending mapping can be approved.' using errcode = 'P0001';
  end if;
  -- checked again at approval: the person may have moved since the proposal
  v_check := private.croc_profile_check(m.profile_id, m.department_id, m.division);
  if not coalesce((v_check ->> 'eligible')::boolean, false) then
    raise exception 'VALIDATION_ERROR: % is no longer an active member of this department''s Sales.', v_check ->> 'name' using errcode = '22023';
  end if;
  update public.crocodial_employee_mappings set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(), effective_from = now(),
         role_snapshot = jsonb_build_object('role', v_check ->> 'role', 'salesSubRole', v_check ->> 'salesSubRole', 'teamId', v_check ->> 'teamId',
                                            'teamName', v_check ->> 'teamName')
   where id = p_id returning * into m;
  perform private.write_audit('CROCODIAL_MAPPING_APPROVED', 'crocodial_mapping', m.id, m.department_id, (v_check ->> 'teamId')::uuid,
    jsonb_build_object('connectionId', m.connection_id, 'externalEmployeeId', m.external_employee_id, 'profileId', m.profile_id));
  return private.croc_mapping_json(m);
end $$;


-- croc_mapping_revoke (from 20270115000100; the connection through the mapping)
create or replace function public.croc_mapping_revoke(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.crocodial_employee_mappings;
begin
  perform private.croc_require_manager((select x.connection_id from public.crocodial_employee_mappings x where x.id = p_id));
  select * into m from public.crocodial_employee_mappings where id = p_id for update;
  if m.id is null then
    raise exception 'NOT_FOUND: Mapping not found.' using errcode = 'P0002';
  end if;
  if m.status = 'REVOKED' then
    raise exception 'CONFLICT: This mapping has already ended.' using errcode = 'P0001';
  end if;
  update public.crocodial_employee_mappings set status = 'REVOKED', ended_at = now(), end_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id returning * into m;
  perform private.write_audit('CROCODIAL_MAPPING_REVOKED', 'crocodial_mapping', m.id, m.department_id, null,
    jsonb_build_object('connectionId', m.connection_id, 'externalEmployeeId', m.external_employee_id, 'profileId', m.profile_id, 'reason', m.end_reason));
  return private.croc_mapping_json(m);
end $$;


-- croc_mapping_count_from (from 20270116000300; the connection through the mapping)
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
  perform private.croc_require_manager((select x.connection_id from public.crocodial_employee_mappings x where x.id = p_id));
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

-- croc_admin_connection (from 20270115000100)
create or replace function public.croc_admin_connection(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
begin
  perform private.croc_require_manager(p_id);
  select * into c from public.crocodial_connections where id = p_id;
  if c.id is null then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  return private.croc_connection_json(c);
end $$;

-- ---------------------------------------------------------------------------
-- 4. The server (service role): what the account reported, and the connection's health

-- croc_sync_request (from 20270115000500)
create or replace function public.croc_sync_request(p_connection uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
begin
  perform private.croc_require_manager(p_connection);
  select * into c from public.crocodial_connections where id = p_connection for update;
  if c.id is null then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  if not private.croc_connection_syncable(c.id) then
    raise exception 'VALIDATION_ERROR: Switch the connection and its department on before syncing.' using errcode = '22023';
  end if;
  if c.last_manual_sync_at > now() - interval '1 minute' then
    raise exception 'CONFLICT: A sync was started less than a minute ago. Try again shortly.' using errcode = 'P0001';
  end if;
  update public.crocodial_connections set last_manual_sync_at = now() where id = c.id;
  perform private.write_audit('CROCODIAL_SYNC_REQUESTED', 'crocodial_connection', c.id, null, null, '{}'::jsonb);
  return jsonb_build_object('id', c.id, 'credentialRef', c.credential_ref);
end $$;
revoke all on function public.croc_sync_request(uuid) from public, anon;
grant execute on function public.croc_sync_request(uuid) to authenticated, service_role;

-- croc_status_mapping_tag_set (from 20270306000100)
create or replace function public.croc_status_mapping_tag_set(p_connection uuid, p_status text, p_tag uuid, p_ignore boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.croc_require_manager(p_connection);
  return private.croc_status_mapping_write(p_connection, p_status, p_tag, p_ignore, null);
end $$;
revoke all on function public.croc_status_mapping_tag_set(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.croc_status_mapping_tag_set(uuid, text, uuid, boolean) to authenticated;

-- croc_lead_import_set (from 20270304000100)
create or replace function public.croc_lead_import_set(p_connection uuid, p_department uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  perform private.croc_require_manager(p_connection);
  if p_mode not in ('OFF', 'PREVIEW', 'IMPORT') then raise exception 'VALIDATION_ERROR: Choose Off, Preview or Import.' using errcode = 'P0001'; end if;
  select lead_import into v_old from public.crocodial_department_links where connection_id = p_connection and department_id = p_department and division = 'SALES' for update;
  if not found then raise exception 'NOT_FOUND: This department is not linked to the connection.' using errcode = 'P0001'; end if;
  update public.crocodial_department_links set lead_import = p_mode where connection_id = p_connection and department_id = p_department and division = 'SALES';
  -- that department's leads are looked at again on the next run (a preview becomes an import, an import stops)
  update public.crocodial_crm_lead_links set last_external_update = null where connection_id = p_connection and (department_id = p_department or department_id is null);
  perform private.write_audit('CROCODIAL_LEAD_IMPORT_SET', 'crocodial_connection', p_connection, p_department, null, jsonb_build_object('from', v_old, 'to', p_mode));
  return jsonb_build_object('departmentId', p_department, 'mode', p_mode);
end $$;
revoke all on function public.croc_lead_import_set(uuid, uuid, text) from public, anon;
grant execute on function public.croc_lead_import_set(uuid, uuid, text) to authenticated;

-- croc_reconcile_overview (from 20270306000100; also the check of the server's "Reconcile now")
create or replace function public.croc_reconcile_overview(p_connection uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.croc_require_manager(p_connection);
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

-- croc_lead_links_list (from 20270304000100)
create or replace function public.croc_lead_links_list(p_connection uuid, p_status text default null, p_page integer default 1, p_page_size integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  perform private.croc_require_manager(p_connection);
  return jsonb_build_object(
    'total', (select count(*) from public.crocodial_crm_lead_links k where k.connection_id = p_connection and (p_status is null or k.status = p_status)),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'externalLeadId', k.external_lead_id, 'status', k.status, 'reason', k.reason, 'assignmentMode', k.assignment_mode, 'importSource', k.import_source,
        'name', e.name, 'company', e.company, 'phone', e.phone_number, 'externalStatus', k.external_status, 'disposition', k.disposition,
        'externalOwner', (select x.name from public.crocodial_ext_employees x where x.connection_id = k.connection_id and x.external_id = k.external_owner_ext),
        'mappedOwner', (select p.full_name from public.profiles p where p.id = k.external_owner_profile),
        'customerId', k.customer_id, 'crmOwner', (select p.full_name from public.customers c join public.profiles p on p.id = c.owner_id where c.id = k.customer_id),
        'department', (select d.name from public.departments d where d.id = k.department_id),
        'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'lifecycle', c.lifecycle_stage, 'owner', (select p.full_name from public.profiles p where p.id = c.owner_id)))
                                  from public.customers c where c.id = any (k.candidate_ids)), '[]'::jsonb),
        'lastReconciledAt', k.last_reconciled_at, 'externalUpdatedAt', k.last_external_update) order by k.updated_at desc)
      from (select * from public.crocodial_crm_lead_links k where k.connection_id = p_connection and (p_status is null or k.status = p_status)
             order by k.updated_at desc offset (v_page - 1) * v_size limit v_size) k
      left join public.crocodial_ext_leads e on e.connection_id = k.connection_id and e.external_id = k.external_lead_id), '[]'::jsonb));
end $$;
revoke all on function public.croc_lead_links_list(uuid, text, integer, integer) from public, anon;
grant execute on function public.croc_lead_links_list(uuid, text, integer, integer) to authenticated;

-- The manager of the connection settles one held lead (the record linked must be of a linked department):
--   LINK (p_customer: a CRM record of the same department) - linked for reference, its owner and stage are not changed;
--   IGNORE - never imported; RETRY - looked at again on the next run; RELEASE_OVERRIDE - Crocodial's assignee applies again.
-- croc_lead_link_resolve (from 20270304000100; the connection through the link, the record of a linked department)
create or replace function public.croc_lead_link_resolve(p_link uuid, p_action text, p_customer uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.crocodial_crm_lead_links;
  c public.customers;
begin
  perform private.croc_require_manager((select x.connection_id from public.crocodial_crm_lead_links x where x.id = p_link));
  select * into k from public.crocodial_crm_lead_links where id = p_link for update;
  if k.id is null then raise exception 'NOT_FOUND: Link not found.' using errcode = 'P0001'; end if;
  if p_action = 'LINK' then
    select * into c from public.customers where id = p_customer;
    if c.id is null or c.department_id is distinct from k.department_id
       or not exists (select 1 from public.crocodial_department_links l where l.connection_id = k.connection_id and l.department_id = c.department_id) then
      raise exception 'VALIDATION_ERROR: Choose a CRM record of the same department.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.crocodial_crm_lead_links x where x.customer_id = c.id and x.connection_id = k.connection_id and x.id <> k.id) then
      raise exception 'CONFLICT: That CRM record is already linked to another Crocodial lead.' using errcode = 'P0001';
    end if;
    update public.crocodial_crm_lead_links set customer_id = c.id, import_source = 'MANUAL',
           status = case when c.lifecycle_stage::text = 'LEAD' then 'LINKED' else 'PROTECTED' end,
           assignment_mode = case when c.owner_id is distinct from k.external_owner_profile then 'CRM_OVERRIDE' else 'EXTERNAL' end,
           applied_owner_id = c.owner_id, reason = case when private.is_super_admin() then 'Linked by the Super Admin.' else 'Linked by the department''s CEO.' end, updated_at = now(), last_applied_at = now()
     where id = k.id;
  elsif p_action = 'IGNORE' then
    update public.crocodial_crm_lead_links set status = 'IGNORED', reason = case when private.is_super_admin() then 'Ignored by the Super Admin.' else 'Ignored by the department''s CEO.' end, updated_at = now() where id = k.id;
  elsif p_action = 'RETRY' then
    update public.crocodial_crm_lead_links set last_external_update = null, status = case when status = 'IGNORED' then 'NOT_ENABLED' else status end, updated_at = now() where id = k.id;
  elsif p_action = 'RELEASE_OVERRIDE' then
    update public.crocodial_crm_lead_links set assignment_mode = 'EXTERNAL', applied_owner_id = (select owner_id from public.customers where id = k.customer_id),
           last_external_update = null, updated_at = now() where id = k.id;
  else
    raise exception 'VALIDATION_ERROR: Unknown action.' using errcode = 'P0001';
  end if;
  perform private.write_audit('CROCODIAL_LEAD_LINK_RESOLVED', 'crocodial_lead_link', k.id, k.department_id, null,
    jsonb_build_object('action', p_action, 'customer', p_customer, 'externalLeadId', k.external_lead_id));
  select * into k from public.crocodial_crm_lead_links where id = p_link;
  return jsonb_build_object('id', k.id, 'status', k.status, 'customerId', k.customer_id, 'assignmentMode', k.assignment_mode);
end $$;
revoke all on function public.croc_lead_link_resolve(uuid, text, uuid) from public, anon;
grant execute on function public.croc_lead_link_resolve(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. Stored Crocodial keys (Task 8): the server encrypts; the service role stores; nobody signed in reads them
-- ---------------------------------------------------------------------------
-- The server's check, as the signed-in user, before it touches a key (the exact FORBIDDEN copy otherwise)
create or replace function public.croc_can_manage_check(p_connection uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.croc_require_manager(p_connection);
end $$;
revoke all on function public.croc_can_manage_check(uuid) from public, anon;
grant execute on function public.croc_can_manage_check(uuid) to authenticated, service_role;

-- croc_require_manager for a named profile (the service role has no signed-in user): the MD, or an active CEO who runs every linked
-- department (private.croc_ceo_runs, as private.is_ceo_for_sales does for the caller)
create or replace function private.croc_actor_require_manager(p_connection uuid, p_actor uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (exists (select 1 from public.profiles p where p.id = p_actor and p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN')
          or (exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection)
              and not exists (select 1 from public.crocodial_department_links l
                               where l.connection_id = p_connection and not coalesce(private.croc_ceo_runs(p_actor, l.department_id), false)))) then
    raise exception 'FORBIDDEN: You can manage Crocodial only for departments you run.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.croc_actor_require_manager(uuid, uuid) from public, anon, authenticated;

-- The audit of a key change, as the actor: the last 4 characters only (never the ciphertext or the fingerprint)
create or replace function private.croc_key_audit(p_action text, p_connection uuid, p_actor uuid, p_metadata jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values ((select id from public.profiles where id = p_actor), p_action, 'crocodial_connection', p_connection, null, null,
          private.scrub_audit_metadata(coalesce(p_metadata, '{}'::jsonb)))
$$;
revoke all on function private.croc_key_audit(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- Store (or replace) a connection's key: the server has checked the caller, the key's shape and one live read, and encrypted it
create or replace function public.croc_token_store(p_connection uuid, p_ciphertext text, p_fingerprint text, p_last4 text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
  v_replaced boolean;
begin
  select * into c from public.crocodial_connections where id = p_connection for update;
  perform private.croc_actor_require_manager(p_connection, p_actor);
  if c.id is null then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  -- only what the server sends: a "v1:" ciphertext (never a plain key), a sha256 hex fingerprint, 4 characters
  if p_ciphertext is null or p_ciphertext !~ '^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' or length(p_ciphertext) > 20000
     or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_last4 is null or length(p_last4) <> 4 then
    raise exception 'VALIDATION_ERROR: The key could not be stored.' using errcode = '22023';
  end if;
  -- the MD's switch-off: only the MD changes the key of a connection the MD switched off
  if c.md_disabled_at is not null and not exists (select 1 from public.profiles p where p.id = p_actor and p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN') then
    raise exception 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.' using errcode = 'P0001';
  end if;
  v_replaced := c.token_ciphertext is not null;
  begin
    update public.crocodial_connections set token_ciphertext = p_ciphertext, token_fingerprint = p_fingerprint, token_last4 = p_last4,
           token_set_by = (select id from public.profiles where id = p_actor), token_set_at = now(), health = 'UNKNOWN', last_error = null, updated_at = now()
     where id = p_connection returning * into c;
  exception when unique_violation then
    -- the other connection's name is not revealed
    raise exception 'CONFLICT: This Crocodial account is already connected (by another department).' using errcode = 'P0001';
  end;
  perform private.croc_key_audit('CROCODIAL_KEY_SET', c.id, p_actor, jsonb_build_object('last4', p_last4, 'replaced', v_replaced));
  return private.croc_connection_json(c);
end $$;

-- Disconnect: the key is cleared and the connection switched off (what was synced stays)
create or replace function public.croc_token_clear(p_connection uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
  v_old public.crocodial_connections;
begin
  select * into v_old from public.crocodial_connections where id = p_connection for update;
  perform private.croc_actor_require_manager(p_connection, p_actor);
  if v_old.id is null then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  -- the MD's switch-off: a non-MD cannot Disconnect it (which would free the key for a new connection)
  if v_old.md_disabled_at is not null and not exists (select 1 from public.profiles p where p.id = p_actor and p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN') then
    raise exception 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.' using errcode = 'P0001';
  end if;
  update public.crocodial_connections set token_ciphertext = null, token_fingerprint = null, token_last4 = null, token_set_by = null, token_set_at = null,
         enabled = false, updated_at = now()
   where id = p_connection returning * into c;
  perform private.croc_key_audit('CROCODIAL_KEY_REMOVED', c.id, p_actor,
    jsonb_build_object('last4', v_old.token_last4, 'hadKey', v_old.token_ciphertext is not null, 'wasEnabled', v_old.enabled));
  return private.croc_connection_json(c);
end $$;

-- The ciphertext, for the server's "Test connection" (after croc_admin_connection checked the caller); the server decrypts it
create or replace function public.croc_token_ciphertext(p_connection uuid)
returns text language sql stable security definer set search_path = '' as $$
  select c.token_ciphertext from public.crocodial_connections c where c.id = p_connection
$$;

-- croc_sync_due (from 20270204000100; also the stored key's ciphertext, decrypted by the server)
create or replace function public.croc_sync_due(p_min_interval interval default interval '15 minutes', p_connection uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'credentialRef', c.credential_ref, 'timezone', c.timezone, 'tokenCiphertext', c.token_ciphertext)
                            order by c.created_at), '[]'::jsonb)
    from public.crocodial_connections c
   where private.croc_connection_syncable(c.id)
     and (p_connection is null or c.id = p_connection)
     and (p_connection is not null
          or not exists (select 1 from public.crocodial_sync_state s where s.connection_id = c.id and s.last_run_at > now() - p_min_interval and s.next_page is null)
          or exists (select 1 from public.crocodial_sync_state s where s.connection_id = c.id and s.next_page is not null)
          or (c.refresh_requested_at is not null
              and c.refresh_requested_at > coalesce((select min(s.last_run_at) from public.crocodial_sync_state s where s.connection_id = c.id), '-infinity'::timestamptz)))
$$;

-- croc_connection_status (from 20270115000100; and KEY_UNREADABLE)
create or replace function public.croc_connection_status(p_connection uuid, p_health text, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_health not in ('OK', 'NO_CREDENTIAL', 'AUTH_FAILED', 'DISABLED_AT_SOURCE', 'RATE_LIMITED', 'ERROR', 'KEY_UNREADABLE') then
    raise exception 'VALIDATION_ERROR: Unknown health.' using errcode = '22023';
  end if;
  update public.crocodial_connections set health = p_health, last_attempt_at = now(),
         last_success_at = case when p_health = 'OK' then now() else last_success_at end,
         last_error = case when p_health = 'OK' then null else left(p_error, 500) end
   where id = p_connection;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['public.croc_token_store(uuid, text, text, text, uuid)', 'public.croc_token_clear(uuid, uuid)',
    'public.croc_token_ciphertext(uuid)', 'public.croc_sync_due(interval, uuid)', 'public.croc_connection_status(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants (as before: signed-in callers; the functions check who may)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public.croc_admin_overview()', 'public.croc_connection_save(jsonb)',
    'public.croc_department_link_save(uuid, uuid, text, boolean, text)', 'public.croc_mapping_check(uuid, bigint, uuid, uuid)',
    'public.croc_mapping_create(uuid, bigint, uuid, uuid)', 'public.croc_mapping_candidates(uuid, uuid)', 'public.croc_mapping_approve(uuid)', 'public.croc_mapping_revoke(uuid, text)',
    'public.croc_mapping_count_from(uuid, date)', 'public.croc_admin_connection(uuid)', 'public.croc_sync_request(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
