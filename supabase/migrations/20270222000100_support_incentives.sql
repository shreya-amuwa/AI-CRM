-- =============================================================================
-- Support incentives (PR 3 of the Incentive & Wallet work; docs/SALES_INCENTIVES.md "Support business"). Run after every earlier migration. Safe to
-- run twice; no data is changed or deleted.
--
-- The Super Admin can now give incentives to Support staff for the business of the customers they look after: a rule "Support business" for a
-- Support department, a Support team or one Support person pays, for every customer payment Accounts verifies on a customer that person looks after
-- (the customer's owner, or the onboarding team member, in a Support team), either a FIXED amount or a PERCENT of the payment; optionally only once
-- the person's verified business that office month has reached a minimum (min_monthly_business), and never above the rule's monthly cap.
-- It is credited to the person's Wallet at once (an earnings row, like every incentive), once per payment and rule, and reversed when the payment
-- leaves Verified - exactly like sales incentives. Sales, demo and field visit rules work as before (they are always FIXED).
-- =============================================================================

alter table public.incentive_rules add column if not exists amount_type text not null default 'FIXED';
alter table public.incentive_rules add column if not exists min_monthly_business numeric(14, 2);
do $$
declare c record;
begin
  -- the event-type checks name every kind of rule / earning: replaced to add SUPPORT_BUSINESS (dropped by name whatever PostgreSQL called them)
  for c in select con.conname, rel.relname from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace n on n.oid = rel.relnamespace
            where n.nspname = 'public' and rel.relname in ('incentive_rules', 'earnings') and con.contype = 'c'
              and pg_get_constraintdef(con.oid) like '%event_type%' and pg_get_constraintdef(con.oid) like '%VISIT_COMPLETED%'
              and con.conname <> 'incentive_rules_sale_check' loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
  alter table public.incentive_rules add constraint incentive_rules_event_type_check check (event_type in ('SALE_PAID', 'DEMO_COMPLETED', 'VISIT_COMPLETED', 'SUPPORT_BUSINESS'));
  alter table public.earnings add constraint earnings_event_type_check check (event_type in ('SALE_PAID', 'DEMO_COMPLETED', 'VISIT_COMPLETED', 'SUPPORT_BUSINESS'));
  if not exists (select 1 from pg_constraint where conname = 'incentive_rules_amount_type_check') then
    alter table public.incentive_rules add constraint incentive_rules_amount_type_check
      check (amount_type in ('FIXED', 'PERCENT') and (amount_type = 'FIXED' or (event_type = 'SUPPORT_BUSINESS' and amount <= 100)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incentive_rules_min_business_check') then
    alter table public.incentive_rules add constraint incentive_rules_min_business_check
      check (min_monthly_business is null or (min_monthly_business > 0 and event_type = 'SUPPORT_BUSINESS'));
  end if;
end $$;

-- The Support people who look after a customer: its owner and its onboarding team member, when they are in a Support team.
create or replace function private.support_carers(p_customer uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.id), '{}') from (
    select c.owner_id as id from public.customers c where c.id = p_customer
    union all
    select o.team_member_id from public.customer_onboarding o where o.customer_id = p_customer) s
  join public.profiles x on x.id = s.id
  join public.teams t on t.id = x.team_id and t.division = 'SUPPORT'
$$;
revoke all on function private.support_carers(uuid) from public, anon, authenticated;

-- The verified business this office month of the customers a Support person looks after.
create or replace function private.support_business_month(p_profile uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(p.amount), 0) from public.customer_payments p
   where p.status = 'VERIFIED'
     and date_trunc('month', coalesce(p.verified_at, p.updated_at) at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata')
     and p_profile = any(private.support_carers(p.customer_id))
$$;
revoke all on function private.support_business_month(uuid) from public, anon, authenticated;

-- A verified payment: every Support business rule in force pays each Support person it applies to who looks after the customer
create or replace function private.earn_support_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  pay public.customer_payments;
  r public.incentive_rules;
  v_ref text := 'SUP:' || p_payment;
  v_person uuid;
  v_people uuid[];
  v_amount numeric;
  v_used numeric;
begin
  select * into pay from public.customer_payments where id = p_payment;
  if pay.id is null or pay.status <> 'VERIFIED' then return; end if;
  v_people := private.support_carers(pay.customer_id);
  if cardinality(v_people) = 0 then return; end if;
  for r in select * from public.incentive_rules x where x.event_type = 'SUPPORT_BUSINESS' and private.incentive_rule_active(x, now()) loop
    foreach v_person in array v_people loop
      continue when not private.incentive_rule_applies(r, v_person);
      continue when r.min_monthly_business is not null and private.support_business_month(v_person) < r.min_monthly_business;
      v_amount := case when r.amount_type = 'PERCENT' then round(pay.amount * r.amount / 100, 2) else r.amount end;
      if r.monthly_cap is not null then
        select coalesce(sum(amount), 0) into v_used from public.earnings
         where profile_id = v_person and rule_id in (select private.incentive_lineage(r.id)) and status = 'EARNED' and event_ref <> v_ref
           and date_trunc('month', earned_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata');
        v_amount := least(v_amount, r.monthly_cap - v_used);
      end if;
      perform private.earn(v_person, r.id, 'SUPPORT_BUSINESS', v_ref, 'PARTICIPANT', pay.customer_id, null, null, v_amount, private.office_today());
    end loop;
  end loop;
end $$;
revoke all on function private.earn_support_payment(uuid) from public, anon, authenticated;

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
  v_type text := coalesce(nullif(btrim(p ->> 'amountType'), ''), 'FIXED');
  v_min numeric;
begin
  -- Support business (20270222000100): a fixed amount per verified payment, or a percentage of it; optionally only once the person's business that month
  -- reaches a minimum. Every other kind of rule is a fixed amount.
  if v_type not in ('FIXED', 'PERCENT') or (v_type = 'PERCENT' and v_event is distinct from 'SUPPORT_BUSINESS') then
    raise exception 'VALIDATION_ERROR: Choose a fixed amount, or a percentage (Support business only).' using errcode = 'P0001';
  end if;
  begin
    v_min := round(nullif(btrim(p ->> 'minMonthlyBusiness'), '')::numeric, 2);
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter the monthly minimum in rupees.' using errcode = 'P0001';
  end;
  if v_min is not null and (v_min <= 0 or v_event is distinct from 'SUPPORT_BUSINESS') then
    raise exception 'VALIDATION_ERROR: A monthly business minimum is for Support business rules, and must be above zero.' using errcode = 'P0001';
  end if;
  begin
    v_amount := round((p ->> 'amount')::numeric, 2);
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter the amount in rupees.' using errcode = 'P0001';
  end;
  if coalesce(length(btrim(p ->> 'name')), 0) not between 1 and 120 then
    raise exception 'VALIDATION_ERROR: Give the rule a name.' using errcode = 'P0001';
  end if;
  if v_event is null or v_event not in ('SALE_PAID', 'DEMO_COMPLETED', 'VISIT_COMPLETED', 'SUPPORT_BUSINESS') then
    raise exception 'VALIDATION_ERROR: Choose what the incentive is for.' using errcode = 'P0001';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 10000000 then
    raise exception 'VALIDATION_ERROR: Enter an amount above zero.' using errcode = 'P0001';
  end if;
  if v_type = 'PERCENT' and v_amount > 100 then
    raise exception 'VALIDATION_ERROR: A percentage is at most 100.' using errcode = 'P0001';
  end if;
  if v_event = 'SALE_PAID' then
    if v_service is null or not exists (select 1 from public.crm_services where code = v_service) or v_scope is distinct from 'OPERATIONS_HEAD'
       or v_value is null or not exists (select 1 from public.profiles where id::text = v_value and is_operations_head and status = 'ACTIVE') then
      raise exception 'VALIDATION_ERROR: A sales incentive needs a product and the Operations Head it is given to.' using errcode = 'P0001';
    end if;
  elsif v_event = 'SUPPORT_BUSINESS' then
    -- who: a Support department, a Support team, or one person of a Support team
    if v_scope is null or v_scope not in ('DEPARTMENT', 'TEAM', 'PERSON') or v_value is null
       or (v_scope = 'DEPARTMENT' and not exists (select 1 from public.teams t where t.department_id::text = v_value and t.division = 'SUPPORT'))
       or (v_scope = 'TEAM' and not exists (select 1 from public.teams t where t.id::text = v_value and t.division = 'SUPPORT'))
       or (v_scope = 'PERSON' and not exists (select 1 from public.profiles x join public.teams t on t.id = x.team_id
                                                where x.id::text = v_value and t.division = 'SUPPORT')) then
      raise exception 'VALIDATION_ERROR: Choose a Support department, a Support team or a person in a Support team.' using errcode = 'P0001';
    end if;
    v_service := null;
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
  insert into public.incentive_rules (name, event_type, service_code, amount, target_units, scope_type, scope_value, monthly_cap, active_from, created_by,
                                      amount_type, min_monthly_business)
  values (btrim(p ->> 'name'), v_event, v_service, v_amount, nullif(p ->> 'targetUnits', '')::integer, v_scope, v_value,
          nullif(p ->> 'monthlyCap', '')::numeric, coalesce(nullif(p ->> 'activeFrom', '')::date, private.office_today()), me.id, v_type, v_min)
  returning id into v_id;
  if v_old.id is not null then
    insert into public.incentive_allocations (rule_id, recipient_id, amount, set_by, set_at)
    select v_id, a.recipient_id, least(a.amount, v_amount), a.set_by, now() from public.incentive_allocations a where a.rule_id = v_old.id;
  end if;
  perform private.write_audit('INCENTIVE_RULE_CREATED', 'incentive_rule', v_id, null, null,
    jsonb_build_object('name', btrim(p ->> 'name'), 'eventType', v_event, 'amount', v_amount, 'amountType', v_type, 'minMonthlyBusiness', v_min, 'scopeType', v_scope, 'scopeValue', v_value,
                       'replacesRuleId', v_old.id));
  return v_id;
end $$;
revoke all on function public.incentive_rule_create(jsonb) from public, anon;
grant execute on function public.incentive_rule_create(jsonb) to authenticated;

create or replace function public.incentive_rule_update(p_rule uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_incentive_admin();
  r public.incentive_rules;
  before jsonb;
  v_new uuid;
  v_replace boolean;
  v_spec jsonb;
  v_amount numeric;
  v_target integer;
  v_cap numeric;
  v_service text;
  v_scope text;
  v_value text;
  v_type text;
  v_min numeric;
begin
  -- only these can change; anything else (what it rewards, when it starts) is ignored
  p := coalesce(p, '{}'::jsonb) - array(select k from jsonb_object_keys(coalesce(p, '{}'::jsonb)) k
         where k not in ('name', 'amount', 'targetUnits', 'monthlyCap', 'serviceCode', 'scopeType', 'scopeValue', 'amountType', 'minMonthlyBusiness'));
  select * into r from public.incentive_rules where id = p_rule for update;
  if r.id is null then
    raise exception 'NOT_FOUND: This rule does not exist.' using errcode = 'P0001';
  end if;
  if not private.incentive_rule_current(r) then
    raise exception 'CONFLICT: This rule has ended; create a new one instead.' using errcode = 'P0001';
  end if;
  before := private.incentive_rule_json(r);
  begin
    v_amount := case when p ? 'amount' then round((p ->> 'amount')::numeric, 2) else r.amount end;
    v_target := case when p ? 'targetUnits' then nullif(btrim(p ->> 'targetUnits'), '')::integer else r.target_units end;
    v_cap := case when p ? 'monthlyCap' then round(nullif(btrim(p ->> 'monthlyCap'), '')::numeric, 2) else r.monthly_cap end;
    v_min := case when p ? 'minMonthlyBusiness' then round(nullif(btrim(p ->> 'minMonthlyBusiness'), '')::numeric, 2) else r.min_monthly_business end;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter the amount and the cap in rupees and the target as a whole number.' using errcode = 'P0001';
  end;
  if v_amount is null or v_amount <= 0 or v_amount > 10000000 then
    raise exception 'VALIDATION_ERROR: Enter an amount above zero.' using errcode = 'P0001';
  end if;
  if (v_target is not null and v_target <= 0) or (v_cap is not null and v_cap <= 0) then
    raise exception 'VALIDATION_ERROR: The target and the monthly cap must be above zero.' using errcode = 'P0001';
  end if;
  if p ? 'name' and coalesce(length(btrim(p ->> 'name')), 0) not between 1 and 120 then
    raise exception 'VALIDATION_ERROR: Give the rule a name.' using errcode = 'P0001';
  end if;
  v_service := case when p ? 'serviceCode' then nullif(btrim(p ->> 'serviceCode'), '') else r.service_code end;
  v_scope := case when p ? 'scopeType' then nullif(btrim(p ->> 'scopeType'), '') else r.scope_type end;
  v_value := case when p ? 'scopeValue' then nullif(btrim(p ->> 'scopeValue'), '') else r.scope_value end;
  if r.event_type <> 'SALE_PAID' then v_service := null; end if;
  v_type := case when p ? 'amountType' then nullif(btrim(p ->> 'amountType'), '') else r.amount_type end;
  v_replace := v_amount is distinct from r.amount or v_service is distinct from r.service_code
            or v_scope is distinct from r.scope_type or v_value is distinct from r.scope_value
            or v_type is distinct from r.amount_type or v_min is distinct from r.min_monthly_business;
  if not v_replace then
    begin
      update public.incentive_rules
         set name = case when p ? 'name' then btrim(p ->> 'name') else name end, target_units = v_target, monthly_cap = v_cap
       where id = r.id returning * into r;
    exception when check_violation or numeric_value_out_of_range then
      raise exception 'VALIDATION_ERROR: Enter the target as a whole number above zero and the cap as an amount above zero.' using errcode = 'P0001';
    end;
    perform private.write_audit('INCENTIVE_RULE_UPDATED', 'incentive_rule', r.id, null, null,
      jsonb_build_object('before', before, 'changes', p, 'replaced', false));
    return private.incentive_rule_json(r);
  end if;
  -- a new amount / product / audience: the old version ends now and a new one starts (earnings already recorded stay as they were)
  v_spec := jsonb_build_object('name', case when p ? 'name' then btrim(p ->> 'name') else r.name end, 'eventType', r.event_type,
              'serviceCode', v_service, 'amount', v_amount, 'targetUnits', v_target, 'scopeType', v_scope, 'scopeValue', v_value, 'monthlyCap', v_cap,
              'amountType', v_type, 'minMonthlyBusiness', v_min);
  begin
    if r.event_type = 'SALE_PAID' and v_value is not distinct from r.scope_value and v_service is not distinct from r.service_code then
      -- same Operations Head and product: the amounts already passed down carry over (capped at the new amount)
      v_new := public.incentive_rule_create(v_spec || jsonb_build_object('replacesRuleId', r.id));
    else
      -- a different product or Operations Head (amounts are passed down again), or an event reward
      update public.incentive_rules set ended_at = now() where id = r.id;
      v_new := public.incentive_rule_create(v_spec);
    end if;
  exception when invalid_text_representation or check_violation or numeric_value_out_of_range then
    raise exception 'VALIDATION_ERROR: Check the amount, the target and the monthly cap.' using errcode = 'P0001';
  end;
  -- the same product for the same Operations Head (sales), or any event reward: the new version shares the old one's limits
  if r.event_type <> 'SALE_PAID' or (v_value is not distinct from r.scope_value and v_service is not distinct from r.service_code) then
    update public.incentive_rules set replaces_rule_id = r.id where id = v_new;
  end if;
  perform private.write_audit('INCENTIVE_RULE_UPDATED', 'incentive_rule', r.id, null, null,
    jsonb_build_object('before', before, 'changes', p, 'replaced', true, 'newRuleId', v_new));
  return (select private.incentive_rule_json(x) from public.incentive_rules x where x.id = v_new);
end $$;
revoke all on function public.incentive_rule_update(uuid, jsonb) from public, anon;
grant execute on function public.incentive_rule_update(uuid, jsonb) to authenticated;

create or replace function private.incentive_rule_json(r public.incentive_rules)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'name', r.name, 'eventType', r.event_type, 'serviceCode', r.service_code,
    'serviceName', (select s.name from public.crm_services s where s.code = r.service_code), 'amount', r.amount, 'targetUnits', r.target_units,
    'scopeType', r.scope_type, 'scopeValue', r.scope_value, 'monthlyCap', r.monthly_cap, 'amountType', r.amount_type, 'minMonthlyBusiness', r.min_monthly_business, 'activeFrom', r.active_from, 'activeTo', r.active_to,
    'endedAt', r.ended_at, 'active', private.incentive_rule_active(r, now()))
$$;
revoke all on function private.incentive_rule_json(public.incentive_rules) from public, anon, authenticated;

create or replace function private.customer_payments_incentives()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.status = 'VERIFIED' and (tg_op = 'INSERT' or old.status is distinct from 'VERIFIED') then
      perform private.earn_sale_payment(new.id);
      perform private.earn_support_payment(new.id);
    elsif tg_op = 'UPDATE' and old.status = 'VERIFIED' and new.status <> 'VERIFIED' then
      perform private.reverse_event('PAY:' || new.id);
      perform private.reverse_event('SUP:' || new.id);
    end if;
  exception when others then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('INCENTIVE_ERROR', 'customer_payment', new.id, jsonb_build_object('error', left(sqlerrm, 300)));
  end;
  return new;
end $$;
revoke all on function private.customer_payments_incentives() from public, anon, authenticated;

notify pgrst, 'reload schema';
