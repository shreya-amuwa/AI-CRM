-- =============================================================================
-- Crocodial integration, part 1: connections, rollout, department links and employee identity mappings
-- (docs/CROCODIAL_INTEGRATION.md, design docs/superpowers/specs/2026-11-19-crocodial-integration-design.md).
-- Additive and safe to run twice; run after every earlier migration.
--
-- One reusable connector, switched on step by step, every step by the Super Admin:
--   crocodial_rollout            which department + function MAY use Crocodial at all (seeded: M Pillar, Sales; nothing else)
--   crocodial_connections        one Crocodial account; its API token lives in a SERVER environment variable whose NAME is stored here
--   crocodial_department_links   a connection serving one department + function (disabled until the Super Admin enables it)
--   crocodial_employee_mappings  one Crocodial user <-> one CRM profile, approved by the Super Admin (switching a department on switches
--                                nobody on); historical: a mapping is revoked with an end time, never rewritten
--   crocodial_ext_employees / crocodial_ext_branches   the account's user and branch list as Crocodial reports it (for choosing mappings)
-- Every table is RLS-on with no grants: the CRM reads them only through the functions below, which check the caller in the database.
-- Nothing here calls Crocodial, writes to Crocodial, or changes any profile, team, customer or lead.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.crocodial_rollout (
  department_id uuid not null references public.departments (id) on delete cascade,
  division text not null check (division in ('SALES')),
  allowed boolean not null default false,
  note text check (note is null or length(note) <= 300),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (department_id, division)
);

create table if not exists public.crocodial_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  external_account_label text check (external_account_label is null or length(external_account_label) <= 200),
  -- the NAME of the server environment variable that holds the API token (never the token)
  credential_ref text not null check (credential_ref ~ '^CROCODIAL_TOKEN_[A-Z0-9_]{1,40}$'),
  enabled boolean not null default false,
  health text not null default 'UNKNOWN'
    check (health in ('UNKNOWN', 'OK', 'NO_CREDENTIAL', 'AUTH_FAILED', 'DISABLED_AT_SOURCE', 'RATE_LIMITED', 'ERROR')),
  last_error text check (last_error is null or length(last_error) <= 500),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  timezone text check (timezone is null or length(timezone) <= 64),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crocodial_connections_credential_key on public.crocodial_connections (credential_ref);

create table if not exists public.crocodial_department_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  division text not null check (division in ('SALES')),
  enabled boolean not null default false,
  stage text not null default 'PILOT' check (stage in ('PILOT', 'PRODUCTION')),
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, department_id, division)
);

create table if not exists public.crocodial_employee_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_employee_id bigint not null check (external_employee_id > 0),
  external_name text check (external_name is null or length(external_name) <= 200),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  division text not null check (division in ('SALES')),
  role_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REVOKED')),
  proposed_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  effective_from timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason is null or length(end_reason) <= 300),
  created_at timestamptz not null default now(),
  check (status <> 'APPROVED' or (approved_at is not null and effective_from is not null)),
  check (status <> 'REVOKED' or ended_at is not null)
);
-- one live mapping per Crocodial user of an account, and per CRM person on an account (numeric ids are only unique within an account)
create unique index if not exists crocodial_mappings_live_external on public.crocodial_employee_mappings (connection_id, external_employee_id)
  where status in ('PENDING', 'APPROVED');
create unique index if not exists crocodial_mappings_live_profile on public.crocodial_employee_mappings (connection_id, profile_id)
  where status in ('PENDING', 'APPROVED');
create index if not exists crocodial_mappings_profile_idx on public.crocodial_employee_mappings (profile_id);

create table if not exists public.crocodial_ext_employees (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_id bigint not null,
  name text check (name is null or length(name) <= 200),
  is_active boolean,
  branch_ids bigint[] not null default '{}',
  external_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  primary key (connection_id, external_id)
);

create table if not exists public.crocodial_ext_branches (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_id bigint not null,
  name text check (name is null or length(name) <= 200),
  status text check (status is null or length(status) <= 40),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  primary key (connection_id, external_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['crocodial_rollout', 'crocodial_connections', 'crocodial_department_links', 'crocodial_employee_mappings',
                           'crocodial_ext_employees', 'crocodial_ext_branches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- only M Pillar's Sales may use Crocodial, until the Super Admin explicitly allows another department
insert into public.crocodial_rollout (department_id, division, allowed, note)
select d.id, 'SALES', true, 'Crocodial pilot'
  from public.departments d where d.slug = 'mpillar'
on conflict (department_id, division) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.croc_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'SUPER_ADMIN'
$$;

create or replace function private.croc_require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.croc_is_admin(), false) then
    raise exception 'FORBIDDEN: Only the Super Admin manages the Crocodial integration.' using errcode = '42501';
  end if;
end $$;

-- the mapping counts at time p_at: approved, in effect, its department link and connection enabled, the person active
create or replace function private.croc_mapping_live(m public.crocodial_employee_mappings, p_at timestamptz default now())
returns boolean language sql stable security definer set search_path = '' as $$
  select m.status in ('APPROVED', 'REVOKED') and m.effective_from is not null and m.effective_from <= p_at
     and (m.ended_at is null or m.ended_at > p_at)
     and exists (select 1 from public.crocodial_connections c where c.id = m.connection_id and c.enabled)
     and exists (select 1 from public.crocodial_department_links l
                  where l.connection_id = m.connection_id and l.department_id = m.department_id and l.division = m.division and l.enabled)
     and exists (select 1 from public.crocodial_rollout r where r.department_id = m.department_id and r.division = m.division and r.allowed)
     and exists (select 1 from public.profiles p where p.id = m.profile_id and p.status = 'ACTIVE')
$$;

-- whether the caller may see this person's Crocodial activity (in that department / function): the person, their own Team Lead,
-- a Department Head / Operations Head whose scope covers that department's Sales, the Super Admin. Nobody else.
create or replace function private.croc_can_view(p_profile uuid, p_department uuid, p_division text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    p_profile = auth.uid()
    or private.my_role() = 'SUPER_ADMIN'
    or (private.my_role() = 'DEPARTMENT_HEAD'
        and exists (select 1 from private.scopes_of(auth.uid()) s
                     where s.department_id = p_department and (s.division is null or s.division = p_division)))
    or (private.my_role() = 'TEAM_HEAD'
        and exists (select 1 from public.profiles me join public.profiles p on p.id = p_profile
                     where me.id = auth.uid() and me.team_id is not null and p.team_id = me.team_id and p.department_id = p_department)
        and private.led_by(auth.uid(), p_profile))
  )
$$;

-- the checks shown before a mapping is approved (and enforced by the approval)
create or replace function private.croc_profile_check(p_profile uuid, p_department uuid, p_division text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profileId', p.id, 'name', p.full_name, 'status', p.status, 'role', p.role, 'salesSubRole', p.sales_sub_role,
    'departmentId', p.department_id, 'departmentName', d.name, 'teamId', p.team_id, 'teamName', t.name, 'teamDivision', t.division,
    'active', p.status = 'ACTIVE',
    'inDepartment', p.department_id = p_department,
    'inFunction', coalesce(t.division::text = p_division, false)
                  or (p.role = 'DEPARTMENT_HEAD' and exists (select 1 from private.scopes_of(p.id) s
                                                             where s.department_id = p_department and (s.division is null or s.division = p_division))),
    'eligible', p.status = 'ACTIVE' and p.department_id = p_department and p.role <> 'SUPER_ADMIN'
                and (coalesce(t.division::text = p_division, false)
                     or (p.role = 'DEPARTMENT_HEAD' and exists (select 1 from private.scopes_of(p.id) s
                                                                where s.department_id = p_department and (s.division is null or s.division = p_division)))))
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    left join public.teams t on t.id = p.team_id
   where p.id = p_profile
$$;

create or replace function private.croc_connection_json(c public.crocodial_connections)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'externalAccountLabel', c.external_account_label, 'credentialRef', c.credential_ref,
    'enabled', c.enabled, 'health', c.health, 'lastError', c.last_error, 'lastAttemptAt', c.last_attempt_at, 'lastSuccessAt', c.last_success_at,
    'timezone', c.timezone, 'createdAt', c.created_at, 'updatedAt', c.updated_at)
$$;

create or replace function private.croc_mapping_json(m public.crocodial_employee_mappings)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'connectionId', m.connection_id, 'externalEmployeeId', m.external_employee_id, 'externalName', m.external_name,
    'profileId', m.profile_id, 'profileName', p.full_name, 'departmentId', m.department_id, 'departmentName', d.name, 'division', m.division,
    'roleSnapshot', m.role_snapshot, 'status', m.status, 'approvedByName', a.full_name, 'approvedAt', m.approved_at,
    'effectiveFrom', m.effective_from, 'endedAt', m.ended_at, 'endReason', m.end_reason, 'createdAt', m.created_at,
    'live', private.croc_mapping_live(m))
    from public.profiles p
    left join public.departments d on d.id = m.department_id
    left join public.profiles a on a.id = m.approved_by
   where p.id = m.profile_id
$$;

-- ---------------------------------------------------------------------------
-- 3. Super Admin: overview and configuration (every change audited)
-- ---------------------------------------------------------------------------
create or replace function public.croc_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.croc_require_admin();
  return jsonb_build_object(
    'rollout', coalesce((select jsonb_agg(jsonb_build_object('departmentId', r.department_id, 'departmentName', d.name, 'departmentSlug', d.slug,
                  'division', r.division, 'allowed', r.allowed, 'note', r.note, 'updatedAt', r.updated_at) order by d.name)
                from public.crocodial_rollout r join public.departments d on d.id = r.department_id), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(private.croc_connection_json(c) order by c.created_at) from public.crocodial_connections c), '[]'::jsonb),
    'departmentLinks', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'connectionId', l.connection_id, 'departmentId', l.department_id,
                  'departmentName', d.name, 'division', l.division, 'enabled', l.enabled, 'stage', l.stage, 'updatedAt', l.updated_at) order by d.name)
                from public.crocodial_department_links l join public.departments d on d.id = l.department_id), '[]'::jsonb),
    'mappings', coalesce((select jsonb_agg(private.croc_mapping_json(m) order by m.created_at desc) from public.crocodial_employee_mappings m), '[]'::jsonb),
    'externalEmployees', coalesce((select jsonb_agg(jsonb_build_object('connectionId', e.connection_id, 'externalId', e.external_id, 'name', e.name,
                  'isActive', e.is_active, 'branchIds', e.branch_ids, 'lastSeenAt', e.last_seen_at, 'missingSince', e.missing_since,
                  'mappingStatus', (select m.status from public.crocodial_employee_mappings m
                                     where m.connection_id = e.connection_id and m.external_employee_id = e.external_id and m.status in ('PENDING', 'APPROVED') limit 1))
                  order by e.name) from public.crocodial_ext_employees e), '[]'::jsonb),
    'externalBranches', coalesce((select jsonb_agg(jsonb_build_object('connectionId', b.connection_id, 'externalId', b.external_id, 'name', b.name,
                  'status', b.status, 'missingSince', b.missing_since) order by b.name) from public.crocodial_ext_branches b), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(x order by (x ->> 'at') desc) from (
                select jsonb_build_object('at', a.created_at, 'action', a.action, 'actorName', p.full_name, 'entityId', a.entity_id, 'metadata', a.metadata) as x
                  from public.audit_logs a left join public.profiles p on p.id = a.actor_id
                 where a.entity_type like 'crocodial%' order by a.created_at desc limit 50) s), '[]'::jsonb)
  );
end $$;

-- the department + function a connection may serve at all (the explicit rollout decision)
create or replace function public.croc_rollout_set(p_department uuid, p_division text, p_allowed boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before boolean;
begin
  perform private.croc_require_admin();
  if p_division is distinct from 'SALES' then
    raise exception 'VALIDATION_ERROR: Crocodial is available for Sales only.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.departments where id = p_department) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0002';
  end if;
  select allowed into v_before from public.crocodial_rollout where department_id = p_department and division = p_division;
  insert into public.crocodial_rollout (department_id, division, allowed, note, updated_by, updated_at)
  values (p_department, p_division, coalesce(p_allowed, false), nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (department_id, division) do update set allowed = excluded.allowed, note = coalesce(excluded.note, public.crocodial_rollout.note),
    updated_by = excluded.updated_by, updated_at = now();
  -- withdrawing the rollout also switches the department's links off (nobody's data is shown or synced for it any more)
  if not coalesce(p_allowed, false) then
    update public.crocodial_department_links set enabled = false, updated_at = now()
     where department_id = p_department and division = p_division and enabled;
  end if;
  perform private.write_audit('CROCODIAL_ROLLOUT_SET', 'crocodial_rollout', p_department, p_department, null,
    jsonb_build_object('division', p_division, 'before', v_before, 'after', coalesce(p_allowed, false)));
  return public.croc_admin_overview();
end $$;

create or replace function public.croc_connection_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := private.try_uuid(p ->> 'id');
  c public.crocodial_connections;
  v_before jsonb;
  v_ref text := upper(btrim(coalesce(p ->> 'credentialRef', '')));
begin
  perform private.croc_require_admin();
  if length(btrim(coalesce(p ->> 'name', ''))) < 2 then
    raise exception 'VALIDATION_ERROR: Give the connection a name.' using errcode = '22023';
  end if;
  if v_ref !~ '^CROCODIAL_TOKEN_[A-Z0-9_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: The credential is the NAME of the server setting that holds the token, like CROCODIAL_TOKEN_MPILLAR (never the token itself).' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.crocodial_connections (name, external_account_label, credential_ref, enabled, created_by)
    values (btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'externalAccountLabel', '')), ''), v_ref, coalesce((p ->> 'enabled')::boolean, false), auth.uid())
    returning * into c;
  else
    select private.croc_connection_json(x) into v_before from public.crocodial_connections x where x.id = v_id for update;
    if v_before is null then
      raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
    end if;
    update public.crocodial_connections set name = btrim(p ->> 'name'),
           external_account_label = nullif(btrim(coalesce(p ->> 'externalAccountLabel', '')), ''),
           credential_ref = v_ref, enabled = coalesce((p ->> 'enabled')::boolean, enabled),
           health = case when credential_ref <> v_ref then 'UNKNOWN' else health end, updated_at = now()
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
  v_before jsonb;
begin
  perform private.croc_require_admin();
  if not exists (select 1 from public.crocodial_connections where id = p_connection) then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  if p_stage not in ('PILOT', 'PRODUCTION') then
    raise exception 'VALIDATION_ERROR: Unknown stage.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.crocodial_rollout r where r.department_id = p_department and r.division = p_division and r.allowed) then
    raise exception 'FORBIDDEN: Crocodial is not rolled out to this department and function. Allow it in the rollout first.' using errcode = '42501';
  end if;
  select to_jsonb(x) into v_before from public.crocodial_department_links x
   where x.connection_id = p_connection and x.department_id = p_department and x.division = p_division;
  insert into public.crocodial_department_links (connection_id, department_id, division, enabled, stage, owner_id)
  values (p_connection, p_department, p_division, coalesce(p_enabled, false), p_stage, auth.uid())
  on conflict (connection_id, department_id, division) do update set enabled = excluded.enabled, stage = excluded.stage, updated_at = now()
  returning * into l;
  perform private.write_audit('CROCODIAL_DEPARTMENT_LINK_SAVED', 'crocodial_department_link', l.id, p_department, null,
    jsonb_build_object('connectionId', p_connection, 'division', p_division, 'before', v_before, 'after', to_jsonb(l)));
  return jsonb_build_object('id', l.id, 'connectionId', l.connection_id, 'departmentId', l.department_id, 'division', l.division,
    'enabled', l.enabled, 'stage', l.stage);
end $$;

-- the checks for a proposed mapping (shown before approval)
create or replace function public.croc_mapping_check(p_connection uuid, p_external_employee bigint, p_profile uuid, p_department uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.croc_require_admin();
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

-- propose a mapping (PENDING): the Crocodial user must be one the account reported, the profile must be eligible
create or replace function public.croc_mapping_create(p_connection uuid, p_external_employee bigint, p_profile uuid, p_department uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_check jsonb;
  e public.crocodial_ext_employees;
  m public.crocodial_employee_mappings;
begin
  perform private.croc_require_admin();
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

create or replace function public.croc_mapping_approve(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.crocodial_employee_mappings;
  v_check jsonb;
begin
  perform private.croc_require_admin();
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

-- ends a mapping (pending or approved): activity before the end stays attributed to the person; nothing after it is
create or replace function public.croc_mapping_revoke(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.crocodial_employee_mappings;
begin
  perform private.croc_require_admin();
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

-- the credential NAME of a connection, for the Super Admin's "Test connection" (the server reads the token from its own environment)
create or replace function public.croc_admin_connection(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
begin
  perform private.croc_require_admin();
  select * into c from public.crocodial_connections where id = p_id;
  if c.id is null then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  return private.croc_connection_json(c);
end $$;

-- ---------------------------------------------------------------------------
-- 4. The server (service role): what the account reported, and the connection's health
-- ---------------------------------------------------------------------------
create or replace function public.croc_store_directory(p_connection uuid, p_employees jsonb, p_branches jsonb, p_timezone text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_e integer;
  v_b integer;
begin
  if not exists (select 1 from public.crocodial_connections where id = p_connection) then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  insert into public.crocodial_ext_employees (connection_id, external_id, name, is_active, branch_ids, external_updated_at, last_seen_at, missing_since)
  select p_connection, (x ->> 'id')::bigint, left(btrim(coalesce(x ->> 'name', '')), 200), (x ->> 'isActive')::boolean,
         coalesce((select array_agg(b::bigint) from jsonb_array_elements_text(coalesce(x -> 'branchIds', '[]'::jsonb)) b), '{}'),
         nullif(x ->> 'updatedAt', '')::timestamptz, v_now, null
    from jsonb_array_elements(coalesce(p_employees, '[]'::jsonb)) x
   where (x ->> 'id') ~ '^[0-9]{1,18}$'
  on conflict (connection_id, external_id) do update set name = excluded.name, is_active = excluded.is_active, branch_ids = excluded.branch_ids,
    external_updated_at = excluded.external_updated_at, last_seen_at = v_now, missing_since = null;
  get diagnostics v_e = row_count;
  insert into public.crocodial_ext_branches (connection_id, external_id, name, status, last_seen_at, missing_since)
  select p_connection, (x ->> 'id')::bigint, left(btrim(coalesce(x ->> 'name', '')), 200), left(x ->> 'status', 40), v_now, null
    from jsonb_array_elements(coalesce(p_branches, '[]'::jsonb)) x
   where (x ->> 'id') ~ '^[0-9]{1,18}$'
  on conflict (connection_id, external_id) do update set name = excluded.name, status = excluded.status, last_seen_at = v_now, missing_since = null;
  get diagnostics v_b = row_count;
  -- a complete list was read: who is no longer in it is marked missing (never deleted; mappings stay as they are)
  update public.crocodial_ext_employees set missing_since = coalesce(missing_since, v_now)
   where connection_id = p_connection and last_seen_at < v_now;
  update public.crocodial_ext_branches set missing_since = coalesce(missing_since, v_now)
   where connection_id = p_connection and last_seen_at < v_now;
  update public.crocodial_connections set timezone = coalesce(nullif(left(p_timezone, 64), ''), timezone) where id = p_connection;
  return jsonb_build_object('employees', v_e, 'branches', v_b);
end $$;

create or replace function public.croc_connection_status(p_connection uuid, p_health text, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_health not in ('OK', 'NO_CREDENTIAL', 'AUTH_FAILED', 'DISABLED_AT_SOURCE', 'RATE_LIMITED', 'ERROR') then
    raise exception 'VALIDATION_ERROR: Unknown health.' using errcode = '22023';
  end if;
  update public.crocodial_connections set health = p_health, last_attempt_at = now(),
         last_success_at = case when p_health = 'OK' then now() else last_success_at end,
         last_error = case when p_health = 'OK' then null else left(p_error, 500) end
   where id = p_connection;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The signed-in employee: is Crocodial switched on for me?
-- ---------------------------------------------------------------------------
create or replace function public.croc_my_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('enabled', true, 'connectionName', c.name, 'externalName', m.external_name, 'departmentName', d.name,
                              'lastSuccessAt', c.last_success_at, 'health', c.health, 'timezone', c.timezone)
      from public.crocodial_employee_mappings m
      join public.crocodial_connections c on c.id = m.connection_id
      join public.departments d on d.id = m.department_id
     where m.profile_id = auth.uid() and m.status = 'APPROVED' and private.croc_mapping_live(m)
     order by m.approved_at desc limit 1), jsonb_build_object('enabled', false))
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public.croc_admin_overview()', 'public.croc_rollout_set(uuid, text, boolean, text)', 'public.croc_connection_save(jsonb)',
    'public.croc_department_link_save(uuid, uuid, text, boolean, text)', 'public.croc_mapping_check(uuid, bigint, uuid, uuid)',
    'public.croc_mapping_create(uuid, bigint, uuid, uuid)', 'public.croc_mapping_approve(uuid)', 'public.croc_mapping_revoke(uuid, text)',
    'public.croc_admin_connection(uuid)', 'public.croc_my_status()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.croc_store_directory(uuid, jsonb, jsonb, text)', 'public.croc_connection_status(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['private.croc_is_admin()', 'private.croc_require_admin()',
    'private.croc_mapping_live(public.crocodial_employee_mappings, timestamptz)', 'private.croc_can_view(uuid, uuid, text)',
    'private.croc_profile_check(uuid, uuid, text)', 'private.croc_connection_json(public.crocodial_connections)',
    'private.croc_mapping_json(public.crocodial_employee_mappings)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
