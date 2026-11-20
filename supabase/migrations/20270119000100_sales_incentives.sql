-- =============================================================================
-- Sales incentives and "My Income" (phase 1; docs/SALES_INCENTIVES.md, design docs/superpowers/specs/2026-11-20-sales-incentives-income-design.md).
--
-- 1. Rules and the cascade. The Super Admin creates incentive rules. A sales rule (SALE_PAID) gives an Operations Head an amount per
--    product unit; each level passes an amount down to the level below (never more than it holds itself) and keeps the difference:
--    Operations Head -> Department Head -> Team Lead -> Team Member. A Department Head sets how a telecaller's lead closed by a Business
--    Associate is split between the two. Rules are never edited: a change ends the rule and starts a new one.
-- 2. The earnings ledger: an earning is recorded the moment its event happens (a customer payment verified by Accounts, released in
--    proportion to the order; a demo completed with the authorised person present; a field visit completed with GPS), and reversed if
--    the event is undone. Nobody earns before they have completed the start period (15 days by default) in the company.
-- 3. Read functions for the Income page.
-- All money in rupees, numeric(14,2). Safe to run twice; pasteable in the Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings, rules, allocations, splits
-- ---------------------------------------------------------------------------
create table if not exists public.incentive_settings (
  id boolean primary key default true check (id),
  start_after_days integer not null default 15 check (start_after_days between 0 and 365),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.incentive_settings (id) values (true) on conflict (id) do nothing;
alter table public.incentive_settings enable row level security;
revoke all on public.incentive_settings from public, anon, authenticated;

create table if not exists public.incentive_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  event_type text not null check (event_type in ('SALE_PAID', 'DEMO_COMPLETED', 'VISIT_COMPLETED')),
  service_code text references public.crm_services (code) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0 and amount <= 10000000),
  target_units integer check (target_units > 0),
  scope_type text not null check (scope_type in ('OPERATIONS_HEAD', 'LEVEL', 'SUB_ROLE', 'DEPARTMENT', 'TEAM', 'PERSON')),
  scope_value text,
  monthly_cap numeric(14, 2) check (monthly_cap > 0),
  active_from date not null,
  active_to date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint incentive_rules_sale_check check ((event_type = 'SALE_PAID') = (service_code is not null and scope_type = 'OPERATIONS_HEAD')),
  constraint incentive_rules_period_check check (active_to is null or active_to >= active_from)
);
-- ended (by the Super Admin): the rule stops at that moment; earnings already recorded stay
alter table public.incentive_rules add column if not exists ended_at timestamptz;
create index if not exists incentive_rules_event_idx on public.incentive_rules (event_type, active_from);

-- A rule is in force on a day when it has started, has not passed its last day and has not been ended.
create or replace function private.incentive_rule_active(r public.incentive_rules, p_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select r.active_from <= (p_at at time zone 'Asia/Kolkata')::date and (r.active_to is null or r.active_to >= (p_at at time zone 'Asia/Kolkata')::date)
     and (r.ended_at is null or r.ended_at > p_at)
$$;
revoke all on function private.incentive_rule_active(public.incentive_rules, timestamptz) from public, anon, authenticated;
alter table public.incentive_rules enable row level security;
revoke all on public.incentive_rules from public, anon, authenticated;

create table if not exists public.incentive_allocations (
  rule_id uuid not null references public.incentive_rules (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(14, 2) not null check (amount >= 0),
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (rule_id, recipient_id)
);
alter table public.incentive_allocations enable row level security;
revoke all on public.incentive_allocations from public, anon, authenticated;

create table if not exists public.incentive_splits (
  department_id uuid primary key references public.departments (id) on delete cascade,
  telecaller_pct integer not null default 50 check (telecaller_pct between 0 and 100),
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.incentive_splits enable row level security;
revoke all on public.incentive_splits from public, anon, authenticated;

-- The person and everyone above them in Sales, nearest first: Team Member -> Team Lead -> Department Head -> Operations Head.
-- Missing levels are left out (nobody is invented).
create or replace function private.incentive_chain(p_profile uuid)
returns table (ord integer, level text, profile_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles;
  v_tl uuid;
  v_dh uuid;
  v_oh uuid;
begin
  select * into p from public.profiles where id = p_profile;
  if p.id is null then return; end if;
  select operations_head_id into v_oh from public.department_operations_owner where department_id = p.department_id;
  if p.is_operations_head then
    ord := 4; level := 'OPERATIONS_HEAD'; profile_id := p.id; return next; return;
  end if;
  if p.role = 'DEPARTMENT_HEAD' then
    v_dh := p.id;
  else
    select (private.department_head_of(p.department_id, null, 'SALES')).id into v_dh;
    if v_dh is not null and v_dh = v_oh then v_dh := null; end if;
  end if;
  if p.role = 'TEAM_MEMBER' then
    ord := 1; level := 'TEAM_MEMBER'; profile_id := p.id; return next;
    select id into v_tl from public.profiles
     where team_id = p.team_id and role = 'TEAM_HEAD' and status = 'ACTIVE' order by created_at, id limit 1;
  elsif p.role = 'TEAM_HEAD' then
    v_tl := p.id;
  end if;
  if v_tl is not null then ord := 2; level := 'TEAM_HEAD'; profile_id := v_tl; return next; end if;
  if v_dh is not null then ord := 3; level := 'DEPARTMENT_HEAD'; profile_id := v_dh; return next; end if;
  if v_oh is not null then ord := 4; level := 'OPERATIONS_HEAD'; profile_id := v_oh; return next; end if;
end $$;
revoke all on function private.incentive_chain(uuid) from public, anon, authenticated;

-- What a person holds per unit under a sales rule: the rule's amount for its Operations Head, otherwise what was passed down to them.
create or replace function private.incentive_amount(p_rule uuid, p_profile uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.amount from public.incentive_rules r where r.id = p_rule and r.scope_type = 'OPERATIONS_HEAD' and r.scope_value = p_profile::text),
    (select a.amount from public.incentive_allocations a where a.rule_id = p_rule and a.recipient_id = p_profile),
    0)
$$;
revoke all on function private.incentive_amount(uuid, uuid) from public, anon, authenticated;

-- The people one level below someone, to whom they pass an amount down.
create or replace function private.incentive_reports(p_profile uuid)
returns table (profile_id uuid, full_name text, level text)
language sql stable security definer set search_path = '' as $$
  with me as (select * from public.profiles where id = p_profile)
  -- an Operations Head: the Department Heads of the departments they own
  select (private.department_head_of(o.department_id, null, 'SALES')).id, (private.department_head_of(o.department_id, null, 'SALES')).full_name, 'DEPARTMENT_HEAD'
    from me join public.department_operations_owner o on o.operations_head_id = me.id
   where me.is_operations_head and (private.department_head_of(o.department_id, null, 'SALES')).id is not null
     and (private.department_head_of(o.department_id, null, 'SALES')).id <> me.id
  union
  -- a Department Head: the Team Leads of their department's Sales teams
  select p.id, p.full_name, 'TEAM_HEAD'
    from me join public.profiles p on p.department_id = me.department_id and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE'
    join public.teams t on t.id = p.team_id and t.division = 'SALES'
   where me.role = 'DEPARTMENT_HEAD' and not me.is_operations_head
  union
  -- a Team Lead: their team's members
  select p.id, p.full_name, 'TEAM_MEMBER'
    from me join public.profiles p on p.team_id = me.team_id and p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE'
   where me.role = 'TEAM_HEAD'
$$;
revoke all on function private.incentive_reports(uuid) from public, anon, authenticated;

create or replace function private.incentive_rule_json(r public.incentive_rules)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'name', r.name, 'eventType', r.event_type, 'serviceCode', r.service_code,
    'serviceName', (select s.name from public.crm_services s where s.code = r.service_code), 'amount', r.amount, 'targetUnits', r.target_units,
    'scopeType', r.scope_type, 'scopeValue', r.scope_value, 'monthlyCap', r.monthly_cap, 'activeFrom', r.active_from, 'activeTo', r.active_to,
    'endedAt', r.ended_at, 'active', private.incentive_rule_active(r, now()))
$$;
revoke all on function private.incentive_rule_json(public.incentive_rules) from public, anon, authenticated;

create or replace function private.require_incentive_admin()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin sets incentive rules.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.require_incentive_admin() from public, anon, authenticated;

-- The Super Admin creates a rule. p: name, eventType, serviceCode, amount, targetUnits, scopeType, scopeValue, monthlyCap, activeFrom.
create or replace function public.incentive_rule_create(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_incentive_admin();
  v_event text := p ->> 'eventType';
  v_scope text := p ->> 'scopeType';
  v_value text := nullif(btrim(p ->> 'scopeValue'), '');
  v_service text := nullif(btrim(p ->> 'serviceCode'), '');
  v_amount numeric;
  v_id uuid;
begin
  begin
    v_amount := round((p ->> 'amount')::numeric, 2);
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter the amount in rupees.' using errcode = 'P0001';
  end;
  if coalesce(length(btrim(p ->> 'name')), 0) not between 1 and 120 then
    raise exception 'VALIDATION_ERROR: Give the rule a name.' using errcode = 'P0001';
  end if;
  if v_event is null or v_event not in ('SALE_PAID', 'DEMO_COMPLETED', 'VISIT_COMPLETED') then
    raise exception 'VALIDATION_ERROR: Choose what the incentive is for.' using errcode = 'P0001';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 10000000 then
    raise exception 'VALIDATION_ERROR: Enter an amount above zero.' using errcode = 'P0001';
  end if;
  if v_event = 'SALE_PAID' then
    if v_service is null or not exists (select 1 from public.crm_services where code = v_service) or v_scope is distinct from 'OPERATIONS_HEAD'
       or v_value is null or not exists (select 1 from public.profiles where id::text = v_value and is_operations_head and status = 'ACTIVE') then
      raise exception 'VALIDATION_ERROR: A sales incentive needs a product and the Operations Head it is given to.' using errcode = 'P0001';
    end if;
  else
    if v_scope is null or v_scope not in ('LEVEL', 'SUB_ROLE', 'DEPARTMENT', 'TEAM', 'PERSON') or v_value is null
       or (v_scope = 'LEVEL' and v_value not in ('DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'))
       or (v_scope = 'SUB_ROLE' and v_value not in ('TELECALLER', 'BUSINESS_ASSOCIATE', 'INFLUENCER', 'VISIT_SALES', 'BUSINESS_PARTNER'))
       or (v_scope = 'DEPARTMENT' and not exists (select 1 from public.departments where id::text = v_value))
       or (v_scope = 'TEAM' and not exists (select 1 from public.teams where id::text = v_value))
       or (v_scope = 'PERSON' and not exists (select 1 from public.profiles where id::text = v_value)) then
      raise exception 'VALIDATION_ERROR: Choose who the incentive is for.' using errcode = 'P0001';
    end if;
    v_service := null;
  end if;
  insert into public.incentive_rules (name, event_type, service_code, amount, target_units, scope_type, scope_value, monthly_cap, active_from, created_by)
  values (btrim(p ->> 'name'), v_event, v_service, v_amount, nullif(p ->> 'targetUnits', '')::integer, v_scope, v_value,
          nullif(p ->> 'monthlyCap', '')::numeric, coalesce(nullif(p ->> 'activeFrom', '')::date, private.office_today()), me.id)
  returning id into v_id;
  perform private.write_audit('INCENTIVE_RULE_CREATED', 'incentive_rule', v_id, null, null,
    jsonb_build_object('name', btrim(p ->> 'name'), 'eventType', v_event, 'amount', v_amount, 'scopeType', v_scope, 'scopeValue', v_value));
  return v_id;
end $$;
revoke all on function public.incentive_rule_create(jsonb) from public, anon;
grant execute on function public.incentive_rule_create(jsonb) to authenticated;

-- The Super Admin ends a rule (from today). Earnings already recorded stay.
create or replace function public.incentive_rule_end(p_rule uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_incentive_admin();
  r public.incentive_rules;
begin
  update public.incentive_rules set ended_at = now() where id = p_rule and ended_at is null returning * into r;
  if r.id is null then
    raise exception 'NOT_FOUND: This rule does not exist or has already ended.' using errcode = 'P0001';
  end if;
  perform private.write_audit('INCENTIVE_RULE_ENDED', 'incentive_rule', r.id, null, null, jsonb_build_object('name', r.name));
  return private.incentive_rule_json(r);
end $$;
revoke all on function public.incentive_rule_end(uuid) from public, anon;
grant execute on function public.incentive_rule_end(uuid) to authenticated;

-- A level passes an amount per unit down to the person one level below them (never more than they hold themselves).
create or replace function public.incentive_allocation_set(p_rule uuid, p_recipient uuid, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.incentive_rules;
  v_parent uuid;
  v_top uuid;
  v_mine numeric;
  v_amount numeric := round(p_amount, 2);
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  select * into r from public.incentive_rules where id = p_rule;
  if r.id is null or r.event_type <> 'SALE_PAID' then
    raise exception 'NOT_FOUND: This sales incentive does not exist.' using errcode = 'P0001';
  end if;
  if not private.incentive_rule_active(r, now()) then
    raise exception 'CONFLICT: This incentive has ended; amounts can no longer be changed.' using errcode = 'P0001';
  end if;
  -- the recipient's next level up, and the top of their chain (must be the rule's Operations Head)
  select c.profile_id into v_parent from private.incentive_chain(p_recipient) c where c.ord > coalesce(
    (select c2.ord from private.incentive_chain(p_recipient) c2 where c2.profile_id = p_recipient), 0) order by c.ord limit 1;
  select c.profile_id into v_top from private.incentive_chain(p_recipient) c order by c.ord desc limit 1;
  if v_top is null or v_top::text <> r.scope_value or p_recipient::text = r.scope_value
     or (v_parent is distinct from me.id and me.role <> 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: You can only set the amount for the people directly below you.' using errcode = '42501';
  end if;
  v_mine := private.incentive_amount(p_rule, coalesce(v_parent, me.id));
  if v_amount is null or v_amount < 0 or v_amount > v_mine then
    raise exception 'VALIDATION_ERROR: The amount must be between 0 and %, what you get per unit (it cannot be more than you get).', v_mine using errcode = 'P0001';
  end if;
  insert into public.incentive_allocations (rule_id, recipient_id, amount, set_by, set_at) values (p_rule, p_recipient, v_amount, me.id, now())
  on conflict (rule_id, recipient_id) do update set amount = excluded.amount, set_by = excluded.set_by, set_at = now();
  perform private.write_audit('INCENTIVE_ALLOCATION_SET', 'incentive_rule', p_rule, me.department_id, me.team_id,
    jsonb_build_object('recipientId', p_recipient, 'amount', v_amount));
  return jsonb_build_object('ok', true, 'ruleId', p_rule, 'recipientId', p_recipient, 'amount', v_amount);
end $$;
revoke all on function public.incentive_allocation_set(uuid, uuid, numeric) from public, anon;
grant execute on function public.incentive_allocation_set(uuid, uuid, numeric) to authenticated;

-- A Department Head sets how a telecaller's lead closed by a Business Associate is split (the telecaller's percentage).
create or replace function public.incentive_split_set(p_department uuid, p_telecaller_pct integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or not (me.role = 'SUPER_ADMIN' or (private.department_head_of(p_department, null, 'SALES')).id = me.id) then
    raise exception 'FORBIDDEN: Only this department''s head sets the split.' using errcode = '42501';
  end if;
  if p_telecaller_pct is null or p_telecaller_pct not between 0 and 100 then
    raise exception 'VALIDATION_ERROR: The telecaller''s share must be between 0 and 100%%.' using errcode = 'P0001';
  end if;
  insert into public.incentive_splits (department_id, telecaller_pct, set_by, set_at) values (p_department, p_telecaller_pct, me.id, now())
  on conflict (department_id) do update set telecaller_pct = excluded.telecaller_pct, set_by = excluded.set_by, set_at = now();
  perform private.write_audit('INCENTIVE_SPLIT_SET', 'department', p_department, p_department, null, jsonb_build_object('telecallerPct', p_telecaller_pct));
  return jsonb_build_object('departmentId', p_department, 'telecallerPct', p_telecaller_pct);
end $$;
revoke all on function public.incentive_split_set(uuid, integer) from public, anon;
grant execute on function public.incentive_split_set(uuid, integer) to authenticated;

-- The Super Admin sets after how many days in the company incentives start.
create or replace function public.incentive_settings_set(p_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_incentive_admin();
begin
  if p_days is null or p_days not between 0 and 365 then
    raise exception 'VALIDATION_ERROR: Enter a number of days between 0 and 365.' using errcode = 'P0001';
  end if;
  update public.incentive_settings set start_after_days = p_days, updated_by = me.id, updated_at = now() where id;
  perform private.write_audit('INCENTIVE_SETTINGS_SET', 'incentive_settings', null, null, null, jsonb_build_object('startAfterDays', p_days));
  return jsonb_build_object('startAfterDays', p_days);
end $$;
revoke all on function public.incentive_settings_set(integer) from public, anon;
grant execute on function public.incentive_settings_set(integer) to authenticated;

-- The setup screen: the rules that concern the caller, what they hold, what they passed down, what they keep, the people below them,
-- their department's split and the start setting. The Super Admin sees every rule.
create or replace function public.incentive_setup()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_admin boolean;
  v_rules jsonb;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  v_admin := me.role = 'SUPER_ADMIN';
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) into v_rules from (
    select r.created_at, private.incentive_rule_json(r) || jsonb_build_object(
      'myAmount', private.incentive_amount(r.id, me.id),
      'given', coalesce((select jsonb_agg(jsonb_build_object('recipientId', a.recipient_id, 'amount', a.amount))
                           from public.incentive_allocations a where a.rule_id = r.id and a.set_by = me.id), '[]'::jsonb),
      'kept', private.incentive_amount(r.id, me.id) - coalesce((select max(a.amount) from public.incentive_allocations a where a.rule_id = r.id and a.set_by = me.id), 0)) as j
      from public.incentive_rules r
     where v_admin or (r.event_type = 'SALE_PAID' and private.incentive_amount(r.id, me.id) > 0)) x;
  return jsonb_build_object(
    'rules', v_rules,
    'reports', coalesce((select jsonb_agg(jsonb_build_object('profileId', t.profile_id, 'name', t.full_name, 'level', t.level) order by t.full_name)
                           from private.incentive_reports(me.id) t), '[]'::jsonb),
    'split', (select jsonb_build_object('departmentId', me.department_id, 'telecallerPct', coalesce(s.telecaller_pct, 50))
                from (select 1) one left join public.incentive_splits s on s.department_id = me.department_id),
    'canSplit', v_admin or (me.role = 'DEPARTMENT_HEAD' and (private.department_head_of(me.department_id, null, 'SALES')).id = me.id),
    'isAdmin', v_admin,
    'startAfterDays', (select start_after_days from public.incentive_settings where id));
end $$;
revoke all on function public.incentive_setup() from public, anon;
grant execute on function public.incentive_setup() to authenticated;
