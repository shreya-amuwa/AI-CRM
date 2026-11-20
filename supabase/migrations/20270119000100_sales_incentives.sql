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

-- The department's Sales head: the Department Head labelled Sales, else its head with no Sales / Support label (many departments have one
-- head and never chose a label).
create or replace function private.incentive_sales_head(p_department uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((private.department_head_of(p_department, null, 'SALES')).id, (private.department_head_of(p_department, null, null)).id)
$$;
revoke all on function private.incentive_sales_head(uuid) from public, anon, authenticated;

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
    v_dh := private.incentive_sales_head(p.department_id);
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

-- The people one level below someone, to whom they pass an amount down (the same "next level up" incentive_chain uses): a department's
-- Sales head below its Operations Head (or, when the Operations Head runs the department themselves, its Team Leads), a department's
-- Team Leads below its head, a team's members below its Team Lead, and the members of a team without an active Team Lead below the
-- department's head.
create or replace function private.incentive_reports(p_profile uuid)
returns table (profile_id uuid, full_name text, level text)
language sql stable security definer set search_path = '' as $$
  with me as (select * from public.profiles where id = p_profile),
  -- the departments where this person is the level above the Team Leads
  led as (
    select me.department_id as department_id from me where me.role = 'DEPARTMENT_HEAD' and not me.is_operations_head
    union
    select o.department_id from me join public.department_operations_owner o on o.operations_head_id = me.id
     where me.is_operations_head and (private.incentive_sales_head(o.department_id) is null or private.incentive_sales_head(o.department_id) = me.id)
  ),
  sales_teams as (select t.id, t.department_id from public.teams t join led on led.department_id = t.department_id where t.division = 'SALES')
  select h.id, h.full_name, 'DEPARTMENT_HEAD'
    from me join public.department_operations_owner o on o.operations_head_id = me.id
    join public.profiles h on h.id = private.incentive_sales_head(o.department_id)
   where me.is_operations_head and h.id <> me.id
  union
  select p.id, p.full_name, 'TEAM_HEAD'
    from sales_teams st join public.profiles p on p.team_id = st.id and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE'
  union
  select p.id, p.full_name, 'TEAM_MEMBER'
    from sales_teams st join public.profiles p on p.team_id = st.id and p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE'
   where not exists (select 1 from public.profiles l where l.team_id = st.id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE')
  union
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

-- The Super Admin creates a rule. p: name, eventType, serviceCode, amount, targetUnits, scopeType, scopeValue, monthlyCap, activeFrom,
-- replacesRuleId. Only one sales rule per Operations Head and product is in force at a time (two would pay every sale twice): to change
-- one, pass replacesRuleId: the old rule ends now and the amounts already passed down are carried over (never above the new amount).
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
  v_old public.incentive_rules;
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
  if v_event = 'SALE_PAID' then
    if nullif(p ->> 'replacesRuleId', '') is not null then
      select * into v_old from public.incentive_rules where id::text = p ->> 'replacesRuleId';
      if v_old.id is null or v_old.event_type <> 'SALE_PAID' or v_old.scope_value <> v_value or v_old.service_code <> v_service
         or not private.incentive_rule_active(v_old, now()) then
        raise exception 'VALIDATION_ERROR: The rule to replace must be the sales rule in force for this Operations Head and product.' using errcode = 'P0001';
      end if;
      update public.incentive_rules set ended_at = now() where id = v_old.id;
    end if;
    if exists (select 1 from public.incentive_rules x where x.event_type = 'SALE_PAID' and x.scope_value = v_value and x.service_code = v_service
                and x.ended_at is null and (x.active_to is null or x.active_to >= private.office_today())) then
      raise exception 'CONFLICT: A sales incentive for this product is already in force for this Operations Head. Replace it instead of adding a second one.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.incentive_rules (name, event_type, service_code, amount, target_units, scope_type, scope_value, monthly_cap, active_from, created_by)
  values (btrim(p ->> 'name'), v_event, v_service, v_amount, nullif(p ->> 'targetUnits', '')::integer, v_scope, v_value,
          nullif(p ->> 'monthlyCap', '')::numeric, coalesce(nullif(p ->> 'activeFrom', '')::date, private.office_today()), me.id)
  returning id into v_id;
  if v_old.id is not null then
    insert into public.incentive_allocations (rule_id, recipient_id, amount, set_by, set_at)
    select v_id, a.recipient_id, least(a.amount, v_amount), a.set_by, now() from public.incentive_allocations a where a.rule_id = v_old.id;
  end if;
  perform private.write_audit('INCENTIVE_RULE_CREATED', 'incentive_rule', v_id, null, null,
    jsonb_build_object('name', btrim(p ->> 'name'), 'eventType', v_event, 'amount', v_amount, 'scopeType', v_scope, 'scopeValue', v_value,
                       'replacesRuleId', v_old.id));
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
  if me.id is null or not (me.role = 'SUPER_ADMIN' or private.incentive_sales_head(p_department) = me.id) then
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
    'canSplit', v_admin or (me.role = 'DEPARTMENT_HEAD' and private.incentive_sales_head(me.department_id) = me.id),
    'isAdmin', v_admin,
    'startAfterDays', (select start_after_days from public.incentive_settings where id));
end $$;
revoke all on function public.incentive_setup() from public, anon;
grant execute on function public.incentive_setup() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The earnings ledger
-- ---------------------------------------------------------------------------
create table if not exists public.earnings (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  rule_id uuid not null references public.incentive_rules (id) on delete restrict,
  event_type text not null check (event_type in ('SALE_PAID', 'DEMO_COMPLETED', 'VISIT_COMPLETED')),
  event_ref text not null check (length(event_ref) between 3 and 80),          -- 'PAY:<payment>', 'DEMO:<demo>', 'VISIT:<visit>'
  role text not null check (role in ('CLOSER', 'TELECALLER', 'BUSINESS_ASSOCIATE', 'TEAM_LEAD', 'DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'PARTICIPANT')),
  customer_id uuid references public.customers (id) on delete set null,
  service_code text,
  fraction numeric(9, 6),                                                       -- sales: the share of the order this payment released
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'EARNED' check (status in ('EARNED', 'REVERSED')),
  earned_at timestamptz not null default now(),
  reversed_at timestamptz,
  unique (profile_id, rule_id, event_ref, role)
);
create index if not exists earnings_person_idx on public.earnings (profile_id, earned_at desc);
create index if not exists earnings_event_idx on public.earnings (event_ref);
create index if not exists earnings_customer_rule_idx on public.earnings (customer_id, rule_id) where status = 'EARNED';
alter table public.earnings enable row level security;
revoke all on public.earnings from public, anon, authenticated;

-- The day someone's incentives start: their joining date (HR's record, else the day the account was approved or created) plus the start
-- period (15 days by default).
create or replace function private.incentive_start_date(p_profile uuid)
returns date language sql stable security definer set search_path = '' as $$
  select coalesce(d.joining_date, p.approved_at::date, p.created_at::date) + (select start_after_days from public.incentive_settings where id)
    from public.profiles p left join public.employee_personal_details d on d.profile_id = p.id
   where p.id = p_profile
$$;
revoke all on function private.incentive_start_date(uuid) from public, anon, authenticated;

create or replace function private.incentive_eligible(p_profile uuid, p_on date)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_on >= private.incentive_start_date(p_profile), false)
$$;
revoke all on function private.incentive_eligible(uuid, date) from public, anon, authenticated;

-- One earning row (once per person, rule, event and role; a row reversed earlier becomes earned again).
create or replace function private.earn(p_profile uuid, p_rule uuid, p_event_type text, p_event_ref text, p_role text, p_customer uuid,
                                        p_service text, p_fraction numeric, p_amount numeric, p_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- only active staff earn (someone who has left keeps their customers for a while, not their incentives)
  if p_profile is null or round(p_amount, 2) <= 0 or not private.incentive_eligible(p_profile, p_on)
     or not exists (select 1 from public.profiles where id = p_profile and status = 'ACTIVE') then return; end if;
  insert into public.earnings (profile_id, rule_id, event_type, event_ref, role, customer_id, service_code, fraction, amount)
  values (p_profile, p_rule, p_event_type, p_event_ref, p_role, p_customer, p_service, p_fraction, round(p_amount, 2))
  on conflict (profile_id, rule_id, event_ref, role) do update
    set status = 'EARNED', amount = excluded.amount, fraction = excluded.fraction, earned_at = now(), reversed_at = null
    where public.earnings.status = 'REVERSED';
end $$;
revoke all on function private.earn(uuid, uuid, text, text, text, uuid, text, numeric, numeric, date) from public, anon, authenticated;

create or replace function private.reverse_event(p_event_ref text)
returns void language sql security definer set search_path = '' as $$
  update public.earnings set status = 'REVERSED', reversed_at = now() where event_ref = p_event_ref and status = 'EARNED'
$$;
revoke all on function private.reverse_event(text) from public, anon, authenticated;

-- A customer payment verified by Accounts: each sales rule for one of the customer's products releases its share in proportion to the
-- order (payment / order total, never more than what is left of 100%), to the closer (the customer's owner now) and up their chain,
-- each level keeping the difference between what it holds and what it passed down. A telecaller's lead closed by its Business Associate
-- splits the closer's part by the department's split.
create or replace function private.earn_sale_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  pay public.customer_payments;
  c public.customers;
  r public.incentive_rules;
  v_ref text := 'PAY:' || p_payment;
  v_total numeric;
  v_f numeric;
  v_done numeric;
  v_on date := private.office_today();
  v_below numeric;
  v_amt numeric;
  v_part numeric;
  v_pct integer;
  v_tc uuid;
  v_first boolean;
  v_top uuid;
  ch record;
begin
  select * into pay from public.customer_payments where id = p_payment;
  if pay.id is null or pay.status <> 'VERIFIED' then return; end if;
  select * into c from public.customers where id = pay.customer_id;
  -- the order's full payable amount (GST included when it is added on top), the same total Accounts verifies payments against
  v_total := coalesce(c.deal_amount, c.agreed_amount);
  if c.id is null or c.owner_id is null or v_total is null or v_total <= 0 then return; end if;
  select bc.telecaller_id into v_tc from public.ba_contacts bc where bc.lead_id = c.id and bc.assigned_to = c.owner_id and bc.telecaller_id is not null;
  select coalesce(s.telecaller_pct, 50) into v_pct from (select 1) one left join public.incentive_splits s on s.department_id = c.department_id;
  select ch2.profile_id into v_top from private.incentive_chain(c.owner_id) ch2 order by ch2.ord desc limit 1;
  for r in
    select x.* from public.incentive_rules x
     where x.event_type = 'SALE_PAID' and private.incentive_rule_active(x, now()) and x.scope_value = v_top::text
       and exists (select 1 from public.customer_services cs where cs.customer_id = c.id and cs.service_code = x.service_code)
  loop
    select coalesce(sum(e.f), 0) into v_done from (
      select max(fraction) as f from public.earnings
       where customer_id = c.id and rule_id = r.id and status = 'EARNED' and event_ref <> v_ref group by event_ref) e;
    v_f := least(pay.amount / v_total, 1 - v_done);
    continue when v_f <= 0;
    v_below := 0;
    v_first := true;
    for ch in select * from private.incentive_chain(c.owner_id) order by ord loop
      v_amt := private.incentive_amount(r.id, ch.profile_id);
      if v_first then
        v_part := v_amt * v_f;
        if v_tc is not null then
          perform private.earn(v_tc, r.id, 'SALE_PAID', v_ref, 'TELECALLER', c.id, r.service_code, v_f, round(v_part * v_pct / 100.0, 2), v_on);
          perform private.earn(ch.profile_id, r.id, 'SALE_PAID', v_ref, 'BUSINESS_ASSOCIATE', c.id, r.service_code, v_f,
                               v_part - round(v_part * v_pct / 100.0, 2), v_on);
        else
          perform private.earn(ch.profile_id, r.id, 'SALE_PAID', v_ref, 'CLOSER', c.id, r.service_code, v_f, v_part, v_on);
        end if;
        v_first := false;
      else
        perform private.earn(ch.profile_id, r.id, 'SALE_PAID', v_ref,
                             case ch.level when 'TEAM_HEAD' then 'TEAM_LEAD' else ch.level end, c.id, r.service_code, v_f,
                             greatest(v_amt - v_below, 0) * v_f, v_on);
      end if;
      v_below := greatest(v_amt, v_below);
    end loop;
  end loop;
end $$;
revoke all on function private.earn_sale_payment(uuid) from public, anon, authenticated;

-- Payments: verified -> earn; leaving verified (reversed, rejected, back to pending) -> reverse. A problem here never blocks Accounts: it
-- is written to the audit log instead.
create or replace function private.customer_payments_incentives()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.status = 'VERIFIED' and (tg_op = 'INSERT' or old.status is distinct from 'VERIFIED') then
      perform private.earn_sale_payment(new.id);
    elsif tg_op = 'UPDATE' and old.status = 'VERIFIED' and new.status <> 'VERIFIED' then
      perform private.reverse_event('PAY:' || new.id);
    end if;
  exception when others then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('INCENTIVE_ERROR', 'customer_payment', new.id, jsonb_build_object('error', left(sqlerrm, 300)));
  end;
  return new;
end $$;
revoke all on function private.customer_payments_incentives() from public, anon, authenticated;
drop trigger if exists customer_payments_incentives on public.customer_payments;
create trigger customer_payments_incentives after insert or update of status on public.customer_payments
  for each row execute function private.customer_payments_incentives();

-- ---------------------------------------------------------------------------
-- 3. Demos completed with the authorised person present; field visits completed with GPS
-- ---------------------------------------------------------------------------
alter table public.ba_demos add column if not exists authorised_person_attended boolean not null default false;

-- Does a rule (DEMO_COMPLETED / VISIT_COMPLETED) apply to this person?
create or replace function private.incentive_rule_applies(r public.incentive_rules, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_profile and p.status = 'ACTIVE' and (
    (r.scope_type = 'LEVEL' and p.role::text = r.scope_value)
    or (r.scope_type = 'SUB_ROLE' and p.sales_sub_role = r.scope_value)
    or (r.scope_type = 'DEPARTMENT' and p.department_id::text = r.scope_value)
    or (r.scope_type = 'TEAM' and p.team_id::text = r.scope_value)
    or (r.scope_type = 'PERSON' and p.id::text = r.scope_value)))
$$;
revoke all on function private.incentive_rule_applies(public.incentive_rules, uuid) from public, anon, authenticated;

-- An event reward: every active rule of the type pays its amount to each participant it applies to, once per event, within the rule's
-- monthly cap per person (office month).
create or replace function private.earn_event(p_event_type text, p_event_ref text, p_participants uuid[], p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.incentive_rules;
  v_person uuid;
  v_on date := private.office_today();
  v_used numeric;
  v_amount numeric;
begin
  for r in select * from public.incentive_rules x where x.event_type = p_event_type and private.incentive_rule_active(x, now()) loop
    foreach v_person in array p_participants loop
      continue when v_person is null or not private.incentive_rule_applies(r, v_person);
      v_amount := r.amount;
      if r.monthly_cap is not null then
        select coalesce(sum(amount), 0) into v_used from public.earnings
         where profile_id = v_person and rule_id = r.id and status = 'EARNED' and event_ref <> p_event_ref
           and date_trunc('month', earned_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata');
        v_amount := least(v_amount, r.monthly_cap - v_used);
      end if;
      perform private.earn(v_person, r.id, p_event_type, p_event_ref, 'PARTICIPANT', p_customer, null, null, v_amount, v_on);
    end loop;
  end loop;
end $$;
revoke all on function private.earn_event(text, text, uuid[], uuid) from public, anon, authenticated;

create or replace function private.ba_demos_incentives()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := 'DEMO:' || new.id;
  v_done boolean := new.status = 'COMPLETED' and new.authorised_person_attended;
  v_was boolean := tg_op = 'UPDATE' and old.status = 'COMPLETED' and old.authorised_person_attended;
  bc public.ba_contacts;
begin
  begin
    if v_done and not v_was then
      select * into bc from public.ba_contacts where id = new.contact_id;
      perform private.earn_event('DEMO_COMPLETED', v_ref, array[new.assigned_to, bc.telecaller_id], bc.lead_id);
    elsif v_was and not v_done then
      perform private.reverse_event(v_ref);
    end if;
  exception when others then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('INCENTIVE_ERROR', 'ba_demo', new.id, jsonb_build_object('error', left(sqlerrm, 300)));
  end;
  return new;
end $$;
revoke all on function private.ba_demos_incentives() from public, anon, authenticated;
drop trigger if exists ba_demos_incentives on public.ba_demos;
create trigger ba_demos_incentives after insert or update of status, authorised_person_attended on public.ba_demos
  for each row execute function private.ba_demos_incentives();

create or replace function private.lead_visits_incentives()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := 'VISIT:' || new.id;
  v_done boolean := new.status = 'COMPLETED' and new.gps_captured;
  v_was boolean := tg_op = 'UPDATE' and old.status = 'COMPLETED' and old.gps_captured;
begin
  begin
    if v_done and not v_was then
      perform private.earn_event('VISIT_COMPLETED', v_ref, array[new.employee_id], new.lead_id);
    elsif v_was and not v_done then
      perform private.reverse_event(v_ref);
    end if;
  exception when others then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('INCENTIVE_ERROR', 'lead_visit', new.id, jsonb_build_object('error', left(sqlerrm, 300)));
  end;
  return new;
end $$;
revoke all on function private.lead_visits_incentives() from public, anon, authenticated;
drop trigger if exists lead_visits_incentives on public.lead_visits;
create trigger lead_visits_incentives after insert or update of status, gps_captured on public.lead_visits
  for each row execute function private.lead_visits_incentives();

-- The Business Associate (or their Team Lead / Department Head) records whether the authorised person attended the demo.
create or replace function public.ba_demo_set_authorised(p_demo uuid, p_attended boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  d public.ba_demos;
  owner_p public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  select * into d from public.ba_demos where id = p_demo;
  if d.id is null then
    raise exception 'NOT_FOUND: This demo does not exist.' using errcode = 'P0001';
  end if;
  select * into owner_p from public.profiles where id = d.assigned_to;
  if me.id is null or not (me.id = d.assigned_to or me.role = 'SUPER_ADMIN'
     or (me.role = 'TEAM_HEAD' and me.team_id = owner_p.team_id)
     or (me.role = 'DEPARTMENT_HEAD' and me.department_id = owner_p.department_id)) then
    raise exception 'FORBIDDEN: Only the demo''s Business Associate or their leads can record this.' using errcode = '42501';
  end if;
  update public.ba_demos set authorised_person_attended = coalesce(p_attended, false) where id = p_demo returning * into d;
  perform private.write_audit('BA_DEMO_AUTHORISED_SET', 'ba_demo', d.id, owner_p.department_id, owner_p.team_id, jsonb_build_object('attended', d.authorised_person_attended));
  return jsonb_build_object('id', d.id, 'status', d.status, 'authorisedPersonAttended', d.authorised_person_attended);
end $$;
revoke all on function public.ba_demo_set_authorised(uuid, boolean) from public, anon;
grant execute on function public.ba_demo_set_authorised(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The Income page (the signed-in person's own earnings only)
-- ---------------------------------------------------------------------------
create or replace function public.income_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_today date := private.office_today();
  v_month date := date_trunc('month', private.office_today())::date;
  v_start date;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  v_start := private.incentive_start_date(me.id);
  return (
    with mine as (select * from public.earnings where profile_id = me.id and status = 'EARNED')
    select jsonb_build_object(
      'startsOn', v_start,
      'eligible', v_today >= v_start,
      'today', coalesce((select sum(amount) from mine where (earned_at at time zone 'Asia/Kolkata')::date = v_today), 0),
      'month', coalesce((select sum(amount) from mine where (earned_at at time zone 'Asia/Kolkata')::date >= v_month), 0),
      'total', coalesce((select sum(amount) from mine), 0),
      -- payouts come in phase 2: until then the balance is everything earned
      'balance', coalesce((select sum(amount) from mine), 0),
      'targets', coalesce((
        select jsonb_agg(jsonb_build_object('ruleId', r.id, 'name', r.name, 'serviceName', s.name, 'targetUnits', r.target_units,
                 'unitsDone', coalesce((select round(sum(f), 2) from (select max(e.fraction) as f from mine e where e.rule_id = r.id group by e.event_ref) u), 0))
                 order by r.created_at)
          from public.incentive_rules r left join public.crm_services s on s.code = r.service_code
         where r.event_type = 'SALE_PAID' and r.target_units is not null and private.incentive_rule_active(r, now())
           and private.incentive_amount(r.id, me.id) > 0), '[]'::jsonb),
      'activity', jsonb_build_object(
        'businessThisMonth', coalesce((select sum(p.amount) from public.customer_payments p join public.customers c on c.id = p.customer_id
                                        where c.owner_id = me.id and p.status = 'VERIFIED' and (p.paid_at at time zone 'Asia/Kolkata')::date >= v_month), 0),
        'demosCompletedThisMonth', (select count(*) from public.ba_demos d join public.ba_contacts bc on bc.id = d.contact_id
                                     where d.status = 'COMPLETED' and (d.assigned_to = me.id or bc.telecaller_id = me.id)
                                       and (d.starts_at at time zone 'Asia/Kolkata')::date >= v_month),
        'visitsCompletedThisMonth', (select count(*) from public.lead_visits v
                                      where v.employee_id = me.id and v.status = 'COMPLETED' and (v.completed_at at time zone 'Asia/Kolkata')::date >= v_month)))
  );
end $$;
revoke all on function public.income_summary() from public, anon;
grant execute on function public.income_summary() to authenticated;

create or replace function public.income_earnings(p_from date, p_to date, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'VALIDATION_ERROR: Choose a period of at most 400 days.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.earned_at desc) from (
      select e.earned_at, jsonb_build_object('id', e.id, 'earnedAt', e.earned_at, 'eventType', e.event_type, 'role', e.role, 'amount', e.amount,
               'status', e.status, 'reversedAt', e.reversed_at, 'customerName', coalesce(nullif(btrim(c.company), ''), c.name),
               'serviceName', s.name, 'ruleName', r.name) as j
        from public.earnings e
        join public.incentive_rules r on r.id = e.rule_id
        left join public.customers c on c.id = e.customer_id
        left join public.crm_services s on s.code = e.service_code
       where e.profile_id = me.id and (e.earned_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       order by e.earned_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb);
end $$;
revoke all on function public.income_earnings(date, date, integer) from public, anon;
grant execute on function public.income_earnings(date, date, integer) to authenticated;
