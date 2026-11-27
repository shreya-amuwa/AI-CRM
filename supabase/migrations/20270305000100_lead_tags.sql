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
--  * The tag tables have RLS on and no grants: reads and writes go through functions (a later migration).
-- Additive and safe to run twice; pasteable in the SQL editor. Nothing is deleted.
--
-- Rollback: lead_status is still maintained, so reverting the app is safe with this left in place. To remove it entirely:
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

notify pgrst, 'reload schema';
