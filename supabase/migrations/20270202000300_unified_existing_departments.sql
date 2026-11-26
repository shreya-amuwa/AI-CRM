-- =============================================================================
-- International and Reseller: the departments that ALREADY exist (docs/UNIFIED_DEPARTMENTS.md, "Existing departments").
-- Run after 20270202000200_notification_coverage.sql, and ONLY after 20270127000100_international_reseller_departments.sql and 20270130000100_unified_head_sales_pages.sql. Additive and safe to run twice.
--
-- 20270127000100 made a department "unified" (Sales AND Support for its Department Head, Team Leads and Team Members) only for the two
-- slugs `international` and `reseller`. The departments the owner had already created in the Super Admin's Departments page ("Amuwa
-- International Department", "Amuwa Reseller Department") have other slugs and no team, so the Add Team Member form said
-- "... has no Sales or Support team to manage." and their people opened the generic dashboards.
--
-- The rule is now data, not a slug list. A department is flagged unified_sales_support when ALL of these hold:
--   * its name or slug says International or Reseller (whole word, any case);
--   * it is not the Sales / Support side of another department (facet_of is null);
--   * it has no Sales team and no Support team (so no existing Sales or Support department can ever be matched).
-- Flagged departments get their one GENERAL team when they have no team, and the people already in them get the unified dashboard.
-- Nothing is renamed, no person, lead, customer, ticket, task or report is changed or moved.
--
-- Duplicates: 20270127000100 seeded `international` / `reseller` next to the existing departments. A seeded department is removed ONLY when
-- another International / Reseller department exists AND nothing at all points at it (no person, lead, customer, ticket, task, report ...
-- in it or in its team: every foreign key is checked; audit entries only remember and are kept). If anything is found it is kept and the owner decides.
-- =============================================================================

-- 0. The earlier migrations this one builds on must have been run (every migration runs in file order). Stop here, with the way forward, when not.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'departments' and column_name = 'unified_sales_support')
     or to_regprocedure('private.dept_is_unified(uuid)') is null then
    raise exception 'PREREQUISITE_MISSING: run supabase/migrations/20270127000100_international_reseller_departments.sql first (it adds departments.unified_sales_support and the Sales + Support rules), then every later migration in file order up to this one, then run this file again. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'require_sales_head'
                  and pg_get_functiondef(p.oid) like '%dept_is_unified%') then
    raise exception 'PREREQUISITE_MISSING: run supabase/migrations/20270130000100_unified_head_sales_pages.sql first (the Department Head''s Sales pages for International / Reseller), then run this file again. Nothing was changed.';
  end if;
end $$;

do $$
declare
  d record;
begin
  -- 1. Flag the existing departments that are International / Reseller
  for d in
    select x.id from public.departments x
     where x.facet_of is null and not x.unified_sales_support
       and (x.name ~* '\m(international|reseller)\M' or x.slug ~* '\m(international|reseller)\M')
       and not exists (select 1 from public.teams t where t.department_id = x.id and t.division in ('SALES', 'SUPPORT'))
  loop
    update public.departments set unified_sales_support = true where id = d.id;
  end loop;

  -- 2. Their one team (the AI Studio pattern), when they have none
  insert into public.teams (department_id, name, division)
  select x.id, x.name || ' Team', 'GENERAL' from public.departments x
   where x.unified_sales_support and not exists (select 1 from public.teams t where t.department_id = x.id)
  on conflict do nothing;
end $$;

-- 3. The seeded duplicate of an existing department, only when it is completely unused.
-- Returns true when the department was removed. Every single-column foreign key that points at the department or at one of its teams is
-- checked (the department's own team rows are the seed); the smallest sign of use (a person, a lead, a ticket, a task ...) keeps it.
-- Audit entries do not count as use: they only remember, and deleting the department clears their reference without removing them.
create or replace function private.unified_drop_unused_seed(p_slug text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s uuid;
  r record;
  v_n bigint;
begin
  select id into s from public.departments where slug = p_slug;
  if s is null then
    return false;
  end if;
  -- only in favour of another unified department that is International / Reseller by name (the one the owner created)
  if not exists (select 1 from public.departments o
                  where o.id <> s and o.facet_of is null and o.unified_sales_support
                    and (o.name ~* ('\m' || p_slug || '\M') or o.slug ~* ('\m' || p_slug || '\M'))) then
    return false;
  end if;
  for r in
    select c.conrelid::regclass::text as tbl, a.attname::text as col, c.confrelid = 'public.departments'::regclass as to_department
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1
       and c.confrelid in ('public.departments'::regclass, 'public.teams'::regclass)
       and not (c.conrelid = 'public.teams'::regclass and c.confrelid = 'public.departments'::regclass)
       -- the audit trail only remembers (the department's own creation is audited); the reference is cleared, the entries stay
       and c.conrelid <> 'public.audit_logs'::regclass
  loop
    execute format('select count(*) from %s x where x.%I %s', r.tbl, r.col,
                   case when r.to_department then '= $1' else 'in (select id from public.teams where department_id = $1)' end)
      into v_n using s;
    if v_n > 0 then
      return false;
    end if;
  end loop;
  begin
    delete from public.teams where department_id = s;
    delete from public.departments where id = s;
  exception when others then
    raise notice 'kept the seeded department %: %', p_slug, sqlerrm;
    return false;
  end;
  return true;
end $$;
revoke all on function private.unified_drop_unused_seed(text) from public, anon, authenticated;

do $$
declare
  v_slug text;
begin
  foreach v_slug in array array['international', 'reseller'] loop
    if private.unified_drop_unused_seed(v_slug) then
      raise notice 'removed the unused seeded department % (the existing department is used instead)', v_slug;
    end if;
  end loop;
end $$;

-- 4. The people already in the unified departments get the right dashboard (the trigger of 20270127000100 computes it from the department)
update public.profiles set default_dashboard = default_dashboard
 where department_id in (select id from public.departments where unified_sales_support);
-- ... and a Department Head of one of them who had been given a Sales-only or Support-only side has none: one head for both sides
update public.profiles set head_division = null, default_dashboard = default_dashboard
 where role = 'DEPARTMENT_HEAD' and head_division is not null
   and department_id in (select id from public.departments where unified_sales_support);
