-- =============================================================================
-- Lead tags, part 1: the tag tables, the seed tags, customers.lead_tag_id, the trigger that keeps lead_status equal to the tag's stage, and
-- the backfill. docs/superpowers/specs/2026-11-27-lead-tags-and-ceo-crocodial-connections-design.md, "Part 1: lead tags".
--
-- Rules (enforced here, not in the browser):
--  * Every lead has exactly one tag. A tag counts as one stage (NEW / CONTACTED / INTERESTED / READY_TO_BUY) and lead_status stays equal to
--    it, so every existing reader of lead_status (reports, the pipeline board, incentives, performance) keeps working unchanged.
--  * Setting a tag sets lead_status to the tag's stage. Writing lead_status directly (old clients, Crocodial dispositions) sets the seed tag
--    of that stage, unless the lead's tag already counts as that stage (a form that sends back the same status keeps the chosen tag).
--  * A tag is usable on a lead when it is active and company-wide, or lists the lead's (base) department. Anything else is refused. A lead
--    that moves to a department where its tag is not usable, or whose tag loses that department, gets the seed tag of the same stage: stage
--    totals never change and a department never shows another department's tag.
--  * The 4 seed tags (one per stage) are company-wide, keep their stage and can never be retired, so every stage always has a tag.
--  * Tags never change the lifecycle stage (the lifecycle guard still refuses a status change on a record that is not a lead).
--  * "Runs a department" = private.is_ceo_for_sales: an active CEO (Department Head with is_operations_head) whose scope covers the
--    department's Sales side. Never a plain scope_covers, which also covers ordinary Department Heads.
--  * The tag tables have RLS on and no grants: reads and writes go through the functions in section 6 (lead_tags_list, lead_tag_save,
--    lead_tag_retire; lead_tag_set runs as the caller, so the lead's own RLS decides who may tag it). Only the Managing Director and a
--    CEO (for department tags whose departments they all run) manage tags; every create / change / retire / restore is audited.
-- Additive and safe to run twice; pasteable in the SQL editor. Nothing is deleted.
--
-- Rollback: lead_status is still maintained, so reverting the app is safe with this left in place. To remove it entirely:
--   drop function if exists public.lead_tag_set(uuid, uuid); drop function if exists public.lead_tag_retire(uuid, boolean);
--   drop function if exists public.lead_tag_save(jsonb); drop function if exists public.lead_tags_list(uuid);
--   drop function if exists private.lead_tag_json(uuid, uuid[]); drop function if exists private.lead_tag_duplicate(uuid, text, text, uuid[]);
--   drop function if exists private.lead_tag_can_manage(uuid); drop function if exists private.lead_tag_ceo_departments();
--   drop trigger if exists customers_lead_tag_sync on public.customers;
--   drop trigger if exists operations_head_departments_lead_tags on public.operations_head_departments;
--   drop function if exists private.tg_customers_lead_tag_sync(); drop function if exists private.tg_ohd_lead_tags();
--   alter table public.customers drop column if exists lead_tag_id;
--   drop function if exists private.lead_tag_usable(uuid, uuid); drop function if exists private.lead_tag_seed(text);
--   drop function if exists private.is_ceo_for_sales(uuid);
--   drop table if exists public.lead_tag_departments; drop table if exists public.lead_tags;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.lead_tags (
  id uuid primary key default gen_random_uuid(),
  label text not null check (label = btrim(label) and length(label) between 1 and 40),
  colour text not null check (colour in ('slate', 'blue', 'indigo', 'violet', 'green', 'amber', 'orange', 'red')),
  stage text not null check (stage in ('NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY')),
  scope text not null check (scope in ('COMPANY', 'DEPARTMENTS')),
  seed_stage text unique check (seed_stage is null or seed_stage in ('NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY')),
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references public.profiles (id) on delete set null
);
do $$
begin
  -- the seed of a stage is company-wide, always counts as that stage and is never retired
  if not exists (select 1 from pg_constraint where conname = 'lead_tags_seed_check') then
    alter table public.lead_tags add constraint lead_tags_seed_check
      check (seed_stage is null or (stage = seed_stage and scope = 'COMPANY' and retired_at is null));
  end if;
end $$;

create table if not exists public.lead_tag_departments (
  tag_id uuid not null references public.lead_tags (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  primary key (tag_id, department_id)
);
create index if not exists lead_tag_departments_department on public.lead_tag_departments (department_id);

alter table public.lead_tags enable row level security;
alter table public.lead_tag_departments enable row level security;
revoke all on public.lead_tags from public, anon, authenticated;
revoke all on public.lead_tag_departments from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Seed tags (company-wide, created by the system)
-- ---------------------------------------------------------------------------
insert into public.lead_tags (label, colour, stage, scope, seed_stage, sort_order) values
  ('New', 'slate', 'NEW', 'COMPANY', 'NEW', 10),
  ('Contacted', 'blue', 'CONTACTED', 'COMPANY', 'CONTACTED', 20),
  ('Interested', 'indigo', 'INTERESTED', 'COMPANY', 'INTERESTED', 30),
  ('Ready to buy', 'green', 'READY_TO_BUY', 'COMPANY', 'READY_TO_BUY', 40)
on conflict (seed_stage) do nothing;
insert into public.lead_tags (label, colour, stage, scope, sort_order)
select v.label, v.colour, v.stage, 'COMPANY', v.sort_order
  from (values ('Demo done', 'violet', 'INTERESTED', 35),
               ('No response / unreachable', 'amber', 'CONTACTED', 25),
               ('On hold / future prospect', 'orange', 'CONTACTED', 26)) v (label, colour, stage, sort_order)
 where not exists (select 1 from public.lead_tags t where t.scope = 'COMPANY' and t.created_by is null and lower(t.label) = lower(v.label));

alter table public.customers add column if not exists lead_tag_id uuid references public.lead_tags (id);
create index if not exists customers_lead_tag on public.customers (lead_tag_id);

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- The caller runs p_department for leads: an active CEO whose scope covers its Sales side (whole department or Sales).
create or replace function private.is_ceo_for_sales(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head)
     and private.scope_covers(auth.uid(), p_department, 'SALES')
$$;
revoke all on function private.is_ceo_for_sales(uuid) from public, anon;
grant execute on function private.is_ceo_for_sales(uuid) to authenticated, service_role;

-- A tag may be used on a lead of p_department: active, and company-wide or listing that (base) department.
create or replace function private.lead_tag_usable(p_tag uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lead_tags t
                  where t.id = p_tag and t.retired_at is null
                    and (t.scope = 'COMPANY'
                         or exists (select 1 from public.lead_tag_departments d
                                     where d.tag_id = t.id and p_department is not null
                                       and private.base_department(d.department_id) = private.base_department(p_department))))
$$;
revoke all on function private.lead_tag_usable(uuid, uuid) from public, anon;
grant execute on function private.lead_tag_usable(uuid, uuid) to authenticated, service_role;

-- The seed tag of a stage (always exists, see lead_tags_seed_check).
create or replace function private.lead_tag_seed(p_stage text)
returns uuid language sql stable security definer set search_path = '' as $$
  select t.id from public.lead_tags t where t.seed_stage = p_stage
$$;
revoke all on function private.lead_tag_seed(text) from public, anon;
grant execute on function private.lead_tag_seed(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Keeping the tag and lead_status in step
-- ---------------------------------------------------------------------------
-- Fires on every insert and update: department_id is set from the owner by customers_before_write (which runs first, by name), so an
-- update of owner_id alone also moves the lead's department. Each rule compares old and new, so an unrelated edit changes nothing.
create or replace function private.tg_customers_lead_tag_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tag_changed boolean := tg_op = 'INSERT' or new.lead_tag_id is distinct from old.lead_tag_id;
  v_status_changed boolean := tg_op = 'INSERT' or new.lead_status is distinct from old.lead_status;
  v_dept_changed boolean := tg_op = 'INSERT' or new.department_id is distinct from old.department_id;
begin
  if v_tag_changed and new.lead_tag_id is not null then
    -- 1. a tag was chosen: it must be usable here, and it decides the status
    if not private.lead_tag_usable(new.lead_tag_id, new.department_id) then
      raise exception 'VALIDATION_ERROR: That tag can''t be used in this lead''s department.' using errcode = 'P0001';
    end if;
    new.lead_status := (select t.stage from public.lead_tags t where t.id = new.lead_tag_id);
  elsif new.lead_tag_id is null
        or (v_status_changed and new.lead_status is distinct from (select t.stage from public.lead_tags t where t.id = new.lead_tag_id)) then
    -- 2. no tag, or the status was written to another stage than the tag's: the seed tag of that stage
    new.lead_tag_id := private.lead_tag_seed(new.lead_status);
  elsif v_dept_changed and not private.lead_tag_usable(new.lead_tag_id, new.department_id) then
    -- 3. moved to a department where the tag is not usable: the seed tag of the same stage
    new.lead_tag_id := private.lead_tag_seed(new.lead_status);
  end if;
  return new;
end $$;
revoke all on function private.tg_customers_lead_tag_sync() from public, anon, authenticated;
drop trigger if exists customers_lead_tag_sync on public.customers;
create trigger customers_lead_tag_sync before insert or update on public.customers
  for each row execute function private.tg_customers_lead_tag_sync();

-- A CEO who loses a department: their tags no longer list it, and leads there that used those tags get the seed of the same stage.
create or replace function private.tg_ohd_lead_tags()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_base uuid := private.base_department(old.department_id);
  v_tags uuid[];
begin
  -- nothing lost while another of their CEO rows still gives the Sales side of the same base department (as scopes_of reads a row: a
  -- facet is its own side, else the row's division, else the person's). Only these rows count: the home department and department_access
  -- grants are still in place when operations_scope_apply deletes rows (it changes them afterwards), so they must not keep the department.
  if exists (select 1 from public.operations_head_departments o
               join public.departments d on d.id = o.department_id
               join public.profiles p on p.id = o.profile_id
              where o.profile_id = old.profile_id and coalesce(d.facet_of, d.id) = v_base
                and coalesce(d.facet_division, o.division, p.head_division, 'SALES') = 'SALES') then
    return null;
  end if;
  with removed as (
    delete from public.lead_tag_departments d
     using public.lead_tags t
     where t.id = d.tag_id and t.created_by = old.profile_id and private.base_department(d.department_id) = v_base
    returning d.tag_id)
  select array_agg(distinct r.tag_id) into v_tags from removed r;
  if v_tags is not null then
    update public.customers c set lead_tag_id = private.lead_tag_seed(c.lead_status)
     where c.lead_tag_id = any (v_tags) and not private.lead_tag_usable(c.lead_tag_id, c.department_id);
  end if;
  return null;
end $$;
revoke all on function private.tg_ohd_lead_tags() from public, anon, authenticated;
drop trigger if exists operations_head_departments_lead_tags on public.operations_head_departments;
create trigger operations_head_departments_lead_tags after delete on public.operations_head_departments
  for each row execute function private.tg_ohd_lead_tags();

-- ---------------------------------------------------------------------------
-- 5. Backfill: every record gets the seed tag of its status (counts by lead_status do not change)
-- ---------------------------------------------------------------------------
-- Not an edit by anyone: customers_before_write would stamp updated_at / updated_by on every record (Crocodial's reconciliation would then
-- treat every linked lead as edited in the CRM) and customers_after_write would write an audit entry and a "Customer updated" notification
-- for each one. Both are switched off for this one statement, in one transaction (an error rolls the switch back too).
do $$
begin
  if exists (select 1 from public.customers where lead_tag_id is null) then
    alter table public.customers disable trigger customers_before_write;
    alter table public.customers disable trigger customers_after_write;
    update public.customers set lead_tag_id = private.lead_tag_seed(lead_status) where lead_tag_id is null;
    alter table public.customers enable trigger customers_before_write;
    alter table public.customers enable trigger customers_after_write;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Managing tags: list, save, retire, and setting a lead's tag
-- ---------------------------------------------------------------------------
-- The (base) departments the caller runs for leads (empty for anyone who is not a CEO).
create or replace function private.lead_tag_ceo_departments()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct s.department_id), '{}'::uuid[])
    from private.scopes_of(auth.uid()) s
   where (s.division is null or s.division = 'SALES') and private.is_ceo_for_sales(s.department_id)
$$;
revoke all on function private.lead_tag_ceo_departments() from public, anon;
grant execute on function private.lead_tag_ceo_departments() to authenticated, service_role;

-- May the caller change this tag? The MD: any. A CEO: a department tag whose departments (at least one) are all departments they run.
create or replace function private.lead_tag_can_manage(p_tag uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin()
      or exists (select 1 from public.lead_tags t
                  where t.id = p_tag and t.scope = 'DEPARTMENTS'
                    and exists (select 1 from public.lead_tag_departments d where d.tag_id = t.id)
                    and not exists (select 1 from public.lead_tag_departments d where d.tag_id = t.id and not private.is_ceo_for_sales(d.department_id)))
$$;
revoke all on function private.lead_tag_can_manage(uuid) from public, anon;
grant execute on function private.lead_tag_can_manage(uuid) to authenticated, service_role;

-- Another active tag with the same label (case-insensitive) visible in one of the same departments (a company-wide tag is visible in all).
create or replace function private.lead_tag_duplicate(p_id uuid, p_label text, p_scope text, p_departments uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lead_tags t
                  where t.retired_at is null and t.id is distinct from p_id and lower(t.label) = lower(p_label)
                    and (p_scope = 'COMPANY' or t.scope = 'COMPANY'
                         or exists (select 1 from public.lead_tag_departments d
                                     where d.tag_id = t.id and private.base_department(d.department_id) = any (p_departments))))
$$;
revoke all on function private.lead_tag_duplicate(uuid, text, text, uuid[]) from public, anon, authenticated;

-- One tag as the API returns it. p_count_departments: count only leads in these (base) departments; null = every lead.
create or replace function private.lead_tag_json(p_tag uuid, p_count_departments uuid[] default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'label', t.label, 'colour', t.colour, 'stage', t.stage, 'scope', t.scope,
    'departmentIds', coalesce((select jsonb_agg(d.department_id order by d.department_id) from public.lead_tag_departments d where d.tag_id = t.id), '[]'::jsonb),
    'retired', t.retired_at is not null, 'seed', t.seed_stage is not null,
    'leadCount', (select count(*) from public.customers c
                   where c.lead_tag_id = t.id and c.lifecycle_stage = 'LEAD'
                     and (p_count_departments is null or private.base_department(c.department_id) = any (p_count_departments))),
    'canManage', private.lead_tag_can_manage(t.id))
  from public.lead_tags t where t.id = p_tag
$$;
revoke all on function private.lead_tag_json(uuid, uuid[]) from public, anon, authenticated;

-- The tags the caller may see, in stage order.
--  * the MD: every tag (retired ones marked), or those visible in p_department;
--  * a CEO: the company-wide tags and every tag listing one of their departments (retired ones marked), or those visible in p_department;
--  * anyone else: the tags usable in p_department when it is their own department or one of their scopes, else in their own department,
--    plus that department's retired tags (marked), which its leads may still carry.
create or replace function public.lead_tags_list(p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_md boolean := private.is_super_admin();
  v_ceo uuid[] := private.lead_tag_ceo_departments();
  v_filter uuid := private.base_department(p_department);
  v_dept uuid;
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in to see lead tags.' using errcode = '42501';
  end if;
  if v_md or cardinality(v_ceo) > 0 then
    return coalesce((
      select jsonb_agg(private.lead_tag_json(t.id, case when v_md then null else v_ceo end)
                       order by array_position(array['NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY'], t.stage), t.sort_order, lower(t.label), t.id)
        from public.lead_tags t
       where (v_md or t.scope = 'COMPANY'
              or exists (select 1 from public.lead_tag_departments d where d.tag_id = t.id and private.base_department(d.department_id) = any (v_ceo)))
         and (v_filter is null or t.scope = 'COMPANY'
              or exists (select 1 from public.lead_tag_departments d where d.tag_id = t.id and private.base_department(d.department_id) = v_filter))), '[]'::jsonb);
  end if;
  v_dept := case
    when p_department is null then private.base_department(private.my_department_id())
    when v_filter = private.base_department(private.my_department_id())
         or exists (select 1 from private.scopes_of(auth.uid()) s where s.department_id = v_filter) then v_filter
  end;
  -- (an unknown or foreign department: only the company-wide tags.) Retired tags of the department are listed too, marked retired:
  -- leads keep a retired tag, so the people working them still see its label; lead_tag_usable still refuses choosing one.
  return coalesce((
    select jsonb_agg(private.lead_tag_json(t.id, array[coalesce(v_dept, '00000000-0000-0000-0000-000000000000'::uuid)])
                     order by array_position(array['NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY'], t.stage), t.sort_order, lower(t.label), t.id)
      from public.lead_tags t
     where private.lead_tag_usable(t.id, v_dept)
        or (t.retired_at is not null
            and (t.scope = 'COMPANY'
                 or exists (select 1 from public.lead_tag_departments d
                             where d.tag_id = t.id and v_dept is not null
                               and private.base_department(d.department_id) = private.base_department(v_dept))))), '[]'::jsonb);
end $$;
revoke all on function public.lead_tags_list(uuid) from public, anon;
grant execute on function public.lead_tags_list(uuid) to authenticated;

-- Create (no id) or change a tag: p = {id?, label, colour, stage, departmentIds?}.
--  * departmentIds absent: a new tag is company-wide (the MD) or gets every department the CEO runs; a changed tag keeps its departments.
--  * departmentIds given: [] = company-wide (the MD only); otherwise those departments (a CEO: only departments they run).
--  * A stage change moves every lead with the tag to the new stage (they keep the tag); departments taken away re-seed the leads there.
create or replace function public.lead_tag_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  -- internal role wording ("Operations Head" = CEO): the API relabels it once (shared/roleNames.ts), so people read
  -- "Only the Managing Director or the department's CEO can manage lead tags." (a literal "CEO" here would reach them as "Managing Director")
  c_forbidden constant text := 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.';
  v_md boolean := private.is_super_admin();
  v_ceo uuid[] := private.lead_tag_ceo_departments();
  v_id uuid;
  v_old public.lead_tags;
  v_new public.lead_tags;
  v_label text := btrim(coalesce(p ->> 'label', ''));
  v_colour text := p ->> 'colour';
  v_stage text := p ->> 'stage';
  v_depts uuid[];
  v_old_depts uuid[];
  v_scope text;
  v_changes jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'VALIDATION_ERROR: Invalid lead tag.' using errcode = 'P0001';
  end if;
  if not v_md and cardinality(v_ceo) = 0 then
    raise exception '%', c_forbidden using errcode = '42501';
  end if;
  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    v_id := private.try_uuid(p ->> 'id');
    if v_id is null then raise exception 'VALIDATION_ERROR: Invalid lead tag.' using errcode = 'P0001'; end if;
  end if;
  if length(v_label) not between 1 and 40 then
    raise exception 'VALIDATION_ERROR: Give the tag a label of 1 to 40 characters.' using errcode = 'P0001';
  end if;
  if v_colour is null or v_colour not in ('slate', 'blue', 'indigo', 'violet', 'green', 'amber', 'orange', 'red') then
    raise exception 'VALIDATION_ERROR: Choose one of the tag colours.' using errcode = 'P0001';
  end if;
  if v_stage is null or v_stage not in ('NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY') then
    raise exception 'VALIDATION_ERROR: Choose the stage the tag counts as.' using errcode = 'P0001';
  end if;
  if p ? 'departmentIds' and jsonb_typeof(p -> 'departmentIds') <> 'null' then
    if jsonb_typeof(p -> 'departmentIds') <> 'array' or jsonb_array_length(p -> 'departmentIds') > 20
       or exists (select 1 from jsonb_array_elements(p -> 'departmentIds') e where jsonb_typeof(e) <> 'string' or private.try_uuid(e #>> '{}') is null) then
      raise exception 'VALIDATION_ERROR: Choose up to 20 departments.' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(distinct private.base_department(dp.id)), '{}'::uuid[]) into v_depts
      from jsonb_array_elements_text(p -> 'departmentIds') e
      left join public.departments dp on dp.id = e::uuid;
    if exists (select 1 from jsonb_array_elements_text(p -> 'departmentIds') e where not exists (select 1 from public.departments dp where dp.id = e::uuid)) then
      raise exception 'NOT_FOUND: One of those departments doesn''t exist.' using errcode = 'P0001';
    end if;
  end if;

  -- one tag change at a time, so two people cannot create the same label at once
  perform pg_advisory_xact_lock(hashtext('public.lead_tags'));

  if v_id is not null then
    select * into v_old from public.lead_tags where id = v_id for update;
    if v_old.id is null then raise exception 'NOT_FOUND: That tag doesn''t exist.' using errcode = 'P0001'; end if;
    if not private.lead_tag_can_manage(v_id) then raise exception '%', c_forbidden using errcode = '42501'; end if;
    select coalesce(array_agg(d.department_id order by d.department_id), '{}'::uuid[]) into v_old_depts from public.lead_tag_departments d where d.tag_id = v_id;
    if v_depts is null then v_depts := v_old_depts; end if;
  elsif v_depts is null then
    v_depts := case when v_md then '{}'::uuid[] else v_ceo end;
  end if;
  v_scope := case when cardinality(v_depts) = 0 then 'COMPANY' else 'DEPARTMENTS' end;
  -- a CEO keeps to department tags for departments they run
  if not v_md and (v_scope = 'COMPANY' or exists (select 1 from unnest(v_depts) d where not private.is_ceo_for_sales(d))) then
    raise exception '%', c_forbidden using errcode = '42501';
  end if;
  if v_old.seed_stage is not null and (v_stage <> v_old.seed_stage or v_scope <> 'COMPANY') then
    raise exception 'VALIDATION_ERROR: A stage''s basic tag is company-wide and always counts as that stage.' using errcode = 'P0001';
  end if;
  if (v_old.id is null or v_old.retired_at is null) and private.lead_tag_duplicate(v_id, v_label, v_scope, v_depts) then
    raise exception 'CONFLICT: A tag called "%" is already in use there.', v_label using errcode = 'P0001';
  end if;

  if v_old.id is null then
    insert into public.lead_tags (label, colour, stage, scope, sort_order, created_by)
    values (v_label, v_colour, v_stage, v_scope, coalesce((select max(t.sort_order) from public.lead_tags t), 0) + 10, private.my_id())
    returning * into v_new;
    insert into public.lead_tag_departments (tag_id, department_id) select v_new.id, d from unnest(v_depts) d;
    perform private.write_audit('LEAD_TAG_CREATED', 'lead_tag', v_new.id, null, null,
      jsonb_build_object('label', v_label, 'colour', v_colour, 'stage', v_stage, 'scope', v_scope, 'departmentIds', to_jsonb(v_depts)));
    return private.lead_tag_json(v_new.id, case when v_md then null else v_ceo end);
  end if;

  update public.lead_tags set label = v_label, colour = v_colour, stage = v_stage, scope = v_scope where id = v_id returning * into v_new;
  delete from public.lead_tag_departments d where d.tag_id = v_id and not (d.department_id = any (v_depts));
  insert into public.lead_tag_departments (tag_id, department_id) select v_id, d from unnest(v_depts) d on conflict do nothing;
  if v_new.stage <> v_old.stage then
    -- the tag's leads move to its new stage and keep the tag (the sync trigger keeps a tag whose stage matches the status written);
    -- a record that is no longer a lead cannot change status, so it takes the seed tag of its own status instead
    update public.customers c set lead_status = v_new.stage where c.lead_tag_id = v_id and c.lifecycle_stage = 'LEAD';
    update public.customers c set lead_tag_id = private.lead_tag_seed(c.lead_status) where c.lead_tag_id = v_id and c.lifecycle_stage <> 'LEAD';
  end if;
  if v_depts is distinct from v_old_depts then
    -- leads in departments the tag no longer covers: the seed of the same stage. Coverage only, not lead_tag_usable: that is false for
    -- every lead of a retired tag, and leads keep a retired tag.
    update public.customers c set lead_tag_id = private.lead_tag_seed(c.lead_status)
     where c.lead_tag_id = v_id and v_scope = 'DEPARTMENTS'
       and not exists (select 1 from unnest(v_depts) d where d = private.base_department(c.department_id));
  end if;

  if v_new.label <> v_old.label then v_changes := v_changes || jsonb_build_object('label', jsonb_build_object('from', v_old.label, 'to', v_new.label)); end if;
  if v_new.colour <> v_old.colour then v_changes := v_changes || jsonb_build_object('colour', jsonb_build_object('from', v_old.colour, 'to', v_new.colour)); end if;
  if v_new.stage <> v_old.stage then v_changes := v_changes || jsonb_build_object('stage', jsonb_build_object('from', v_old.stage, 'to', v_new.stage)); end if;
  if v_new.scope <> v_old.scope then v_changes := v_changes || jsonb_build_object('scope', jsonb_build_object('from', v_old.scope, 'to', v_new.scope)); end if;
  if (select array_agg(d order by d) from unnest(v_depts) d) is distinct from (select array_agg(d order by d) from unnest(v_old_depts) d) then
    v_changes := v_changes || jsonb_build_object('departmentIds', jsonb_build_object('from', to_jsonb(v_old_depts), 'to', to_jsonb(v_depts)));
  end if;
  if v_changes <> '{}'::jsonb then
    perform private.write_audit('LEAD_TAG_UPDATED', 'lead_tag', v_id, null, null, jsonb_build_object('label', v_new.label, 'changes', v_changes));
  end if;
  return private.lead_tag_json(v_id, case when v_md then null else v_ceo end);
end $$;
revoke all on function public.lead_tag_save(jsonb) from public, anon;
grant execute on function public.lead_tag_save(jsonb) to authenticated;

-- Retire (p_retired true) or restore a tag. Leads keep a retired tag; it is no longer offered. The seed of a stage is never retired.
create or replace function public.lead_tag_retire(p_id uuid, p_retired boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_tags;
  v_depts uuid[];
  v_ceo uuid[] := private.lead_tag_ceo_departments();
begin
  if p_retired is null then raise exception 'VALIDATION_ERROR: Say whether to retire or restore the tag.' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('public.lead_tags'));
  select * into v from public.lead_tags where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND: That tag doesn''t exist.' using errcode = 'P0001'; end if;
  if not private.lead_tag_can_manage(p_id) then
    raise exception 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.' using errcode = '42501';
  end if;
  if p_retired and v.seed_stage is not null then
    raise exception 'VALIDATION_ERROR: A stage''s basic tag can''t be retired.' using errcode = 'P0001';
  end if;
  if p_retired is distinct from (v.retired_at is not null) then
    if not p_retired then
      select coalesce(array_agg(d.department_id), '{}'::uuid[]) into v_depts from public.lead_tag_departments d where d.tag_id = p_id;
      if private.lead_tag_duplicate(p_id, v.label, v.scope, v_depts) then
        raise exception 'CONFLICT: A tag called "%" is already in use there.', v.label using errcode = 'P0001';
      end if;
    end if;
    update public.lead_tags
       set retired_at = case when p_retired then now() end, retired_by = case when p_retired then private.my_id() end
     where id = p_id;
    perform private.write_audit('LEAD_TAG_RETIRED', 'lead_tag', p_id, null, null, jsonb_build_object('label', v.label, 'retired', p_retired));
  end if;
  return private.lead_tag_json(p_id, case when private.is_super_admin() then null else v_ceo end);
end $$;
revoke all on function public.lead_tag_retire(uuid, boolean) from public, anon;
grant execute on function public.lead_tag_retire(uuid, boolean) to authenticated;

-- Set a lead's tag. Security invoker: the lead's own rules (RLS) decide who may edit it; the sync trigger checks the tag is usable in the
-- lead's department and sets lead_status to its stage.
grant update (lead_tag_id) on public.customers to authenticated;
create or replace function public.lead_tag_set(p_customer uuid, p_tag uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_stage text;
begin
  if p_tag is null then raise exception 'VALIDATION_ERROR: Choose a tag.' using errcode = 'P0001'; end if;
  select c.lifecycle_stage into v_stage from public.customers c where c.id = p_customer;
  if v_stage is null then raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001'; end if;
  if v_stage <> 'LEAD' then raise exception 'VALIDATION_ERROR: Only a lead can be tagged.' using errcode = 'P0001'; end if;
  update public.customers c set lead_tag_id = p_tag where c.id = p_customer;
  if not found then raise exception 'FORBIDDEN: You can''t edit this lead.' using errcode = '42501'; end if;
end $$;
revoke all on function public.lead_tag_set(uuid, uuid) from public, anon;
grant execute on function public.lead_tag_set(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
