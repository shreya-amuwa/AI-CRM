-- =============================================================================
-- Sales incentives, the setup screens (follows 20270119000100_sales_incentives.sql; docs/SALES_INCENTIVES.md).
--
-- 1. The Super Admin edits and deletes rules.
--    - Edit: the name, target and monthly cap change in place. A new amount, product or "who it is for" applies from now on: the old
--      version ends and a new one starts with the same name (a sales rule carries the amounts already passed down), so earnings already
--      recorded keep the amount they were earned at.
--    - Delete: a rule nobody has earned from is removed; a rule with earnings is stopped instead (earned money is never erased).
-- 2. incentive_setup() lists each person directly below the caller with what they currently get and what the caller keeps on them
--    (it used to key on who set the amount, wrong after a Super Admin override), and gives the Super Admin the lists the rule form needs.
-- 3. A Business Associate's demo record carries the "authorised person attended" tick, so their screen shows it.
-- 4. A new version records the one it replaced (incentive_rules.replaces_rule_id), and the limits count every version: a sale never earns
--    more than 100% of the order for a product and Operations Head, and an event reward's monthly cap is not reset by an edit
--    (earn_sale_payment and earn_event are replaced with that one change).
-- Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

-- Each new version of a rule records the one it replaced, so its limits (a sale's 100% of the order, an event reward's monthly cap) count
-- the earnings of every version, not only its own.
alter table public.incentive_rules add column if not exists replaces_rule_id uuid references public.incentive_rules (id) on delete set null;

create or replace function private.incentive_lineage(p_rule uuid)
returns table (id uuid) language sql stable security definer set search_path = '' as $$
  with recursive l (id, prev, depth) as (
    select r.id, r.replaces_rule_id, 0 from public.incentive_rules r where r.id = p_rule
    union all
    select r.id, r.replaces_rule_id, l.depth + 1 from public.incentive_rules r join l on r.id = l.prev where l.depth < 1000)
  select l.id from l
$$;
revoke all on function private.incentive_lineage(uuid) from public, anon, authenticated;

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
    -- every version of this product's rule for this Operations Head shares the order's 100% (an edited amount is a new version)
    select coalesce(sum(e.f), 0) into v_done from (
      select max(ea.fraction) as f from public.earnings ea join public.incentive_rules x on x.id = ea.rule_id
       where ea.customer_id = c.id and x.event_type = 'SALE_PAID' and x.service_code = r.service_code and x.scope_value = r.scope_value
         and ea.status = 'EARNED' and ea.event_ref <> v_ref group by ea.event_ref) e;
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
        -- the cap is shared by every version of the rule (an edited amount is a new version)
        select coalesce(sum(amount), 0) into v_used from public.earnings
         where profile_id = v_person and rule_id in (select l.id from private.incentive_lineage(r.id) l) and status = 'EARNED' and event_ref <> p_event_ref
           and date_trunc('month', earned_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata');
        v_amount := least(v_amount, r.monthly_cap - v_used);
      end if;
      perform private.earn(v_person, r.id, p_event_type, p_event_ref, 'PARTICIPANT', p_customer, null, null, v_amount, v_on);
    end loop;
  end loop;
end $$;
revoke all on function private.earn_event(text, text, uuid[], uuid) from public, anon, authenticated;

-- Not stopped and not past its end date (a rule that starts later counts as current: it can be edited, and blocks a second sales rule).
create or replace function private.incentive_rule_current(r public.incentive_rules)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.ended_at is null and (r.active_to is null or r.active_to >= private.office_today())
$$;
revoke all on function private.incentive_rule_current(public.incentive_rules) from public, anon, authenticated;

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
begin
  -- only these can change; anything else (what it rewards, when it starts) is ignored
  p := coalesce(p, '{}'::jsonb) - array(select k from jsonb_object_keys(coalesce(p, '{}'::jsonb)) k
         where k not in ('name', 'amount', 'targetUnits', 'monthlyCap', 'serviceCode', 'scopeType', 'scopeValue'));
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
  v_replace := v_amount is distinct from r.amount or v_service is distinct from r.service_code
            or v_scope is distinct from r.scope_type or v_value is distinct from r.scope_value;
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
              'serviceCode', v_service, 'amount', v_amount, 'targetUnits', v_target, 'scopeType', v_scope, 'scopeValue', v_value, 'monthlyCap', v_cap);
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

create or replace function public.incentive_rule_delete(p_rule uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_incentive_admin();
  r public.incentive_rules;
  v_alloc jsonb;
begin
  select * into r from public.incentive_rules where id = p_rule for update;
  if r.id is null then
    raise exception 'NOT_FOUND: This rule does not exist.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('recipientId', a.recipient_id, 'amount', a.amount, 'setBy', a.set_by)), '[]'::jsonb) into v_alloc
    from public.incentive_allocations a where a.rule_id = r.id;
  if not exists (select 1 from public.earnings where rule_id = r.id) then
    begin
      delete from public.incentive_rules where id = r.id;
      perform private.write_audit('INCENTIVE_RULE_DELETED', 'incentive_rule', r.id, null, null,
        jsonb_build_object('rule', private.incentive_rule_json(r), 'allocations', v_alloc, 'stoppedOnly', false));
      return jsonb_build_object('id', r.id, 'deleted', true, 'ended', false);
    exception when foreign_key_violation then
      null;   -- an earning arrived meanwhile: stop the rule instead
    end;
  end if;
  update public.incentive_rules set ended_at = coalesce(ended_at, now()) where id = r.id;
  perform private.write_audit('INCENTIVE_RULE_DELETED', 'incentive_rule', r.id, null, null,
    jsonb_build_object('rule', private.incentive_rule_json(r), 'stoppedOnly', true));
  return jsonb_build_object('id', r.id, 'deleted', false, 'ended', true);
end $$;
revoke all on function public.incentive_rule_delete(uuid) from public, anon;
grant execute on function public.incentive_rule_delete(uuid) to authenticated;

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
  select coalesce(jsonb_agg(x.j order by x.active desc, x.created_at desc), '[]'::jsonb) into v_rules from (
    select r.created_at, private.incentive_rule_active(r, now()) as active, private.incentive_rule_json(r) || jsonb_build_object(
      'myAmount', private.incentive_amount(r.id, me.id),
      -- each person directly below, what they currently get, and what the caller keeps on their sales
      'given', case when r.event_type = 'SALE_PAID' then coalesce((
        select jsonb_agg(jsonb_build_object('recipientId', t.profile_id, 'name', t.full_name, 'level', t.level,
                 'amount', coalesce(a.amount, 0),
                 'kept', private.incentive_amount(r.id, me.id) - coalesce(a.amount, 0)) order by t.full_name)
          from private.incentive_reports(me.id) t
          left join public.incentive_allocations a on a.rule_id = r.id and a.recipient_id = t.profile_id), '[]'::jsonb) else '[]'::jsonb end,
      'kept', private.incentive_amount(r.id, me.id) - coalesce((
        select max(a.amount) from private.incentive_reports(me.id) t join public.incentive_allocations a on a.rule_id = r.id and a.recipient_id = t.profile_id), 0),
      'current', private.incentive_rule_current(r),
      'earnedCount', case when v_admin then (select count(*) from public.earnings e where e.rule_id = r.id) end) as j
      from public.incentive_rules r
     where v_admin or (r.event_type = 'SALE_PAID' and private.incentive_rule_active(r, now()) and private.incentive_amount(r.id, me.id) > 0)) x;
  return jsonb_build_object(
    'rules', v_rules,
    'reports', coalesce((select jsonb_agg(jsonb_build_object('profileId', t.profile_id, 'name', t.full_name, 'level', t.level) order by t.full_name)
                           from private.incentive_reports(me.id) t), '[]'::jsonb),
    'split', (select jsonb_build_object('departmentId', me.department_id, 'telecallerPct', coalesce(s.telecaller_pct, 50))
                from (select 1) one left join public.incentive_splits s on s.department_id = me.department_id),
    'canSplit', v_admin or (me.role = 'DEPARTMENT_HEAD' and private.incentive_sales_head(me.department_id) = me.id),
    'isAdmin', v_admin,
    'startAfterDays', (select start_after_days from public.incentive_settings where id),
    -- what the Super Admin's rule form chooses from
    'options', case when v_admin then jsonb_build_object(
      'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order) from public.crm_services s where s.is_active), '[]'::jsonb),
      'operationsHeads', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                                     from public.profiles p where p.is_operations_head and p.status = 'ACTIVE'), '[]'::jsonb),
      'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d), '[]'::jsonb),
      'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'departmentId', t.department_id) order by t.name)
                           from public.teams t where t.division = 'SALES'), '[]'::jsonb),
      -- Sales staff and the heads (a Department Head often has no team); the server accepts any person
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                          from public.profiles p left join public.teams t on t.id = p.team_id
                         where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
                           and (t.division = 'SALES' or p.role = 'DEPARTMENT_HEAD' or p.is_operations_head)), '[]'::jsonb)) end);
end $$;
revoke all on function public.incentive_setup() from public, anon;
grant execute on function public.incentive_setup() to authenticated;

-- 3. A demo carries the "authorised person attended" tick (20270119000100), so the Business Associate's screen shows and sets it.
create or replace function private.ba_demo_row(d public.ba_demos)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'contactId', d.contact_id, 'title', d.title, 'description', d.description, 'startsAt', d.starts_at, 'endsAt', d.ends_at,
    'mode', d.mode, 'location', d.location, 'meetingLink', d.meeting_link, 'assignedTo', d.assigned_to, 'assignee', (select p.full_name from public.profiles p where p.id = d.assigned_to),
    'internalNotes', d.internal_notes, 'status', d.status, 'rescheduleCount', d.reschedule_count, 'feedback', d.feedback, 'followUpNotes', d.follow_up_notes,
    'authorisedPersonAttended', d.authorised_person_attended,
    'client', (select l.name from public.ba_contacts c join public.customers l on l.id = c.lead_id where c.id = d.contact_id),
    'company', (select l.company from public.ba_contacts c join public.customers l on l.id = c.lead_id where c.id = d.contact_id))
$$;
revoke all on function private.ba_demo_row(public.ba_demos) from public, anon, authenticated;
