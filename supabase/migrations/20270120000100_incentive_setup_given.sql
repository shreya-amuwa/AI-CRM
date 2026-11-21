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
-- Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

create or replace function public.incentive_rule_update(p_rule uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_incentive_admin();
  r public.incentive_rules;
  v_new uuid;
  v_replace boolean;
  v_spec jsonb;
begin
  select * into r from public.incentive_rules where id = p_rule;
  if r.id is null then
    raise exception 'NOT_FOUND: This rule does not exist.' using errcode = 'P0001';
  end if;
  if not private.incentive_rule_active(r, now()) then
    raise exception 'CONFLICT: This rule has ended; create a new one instead.' using errcode = 'P0001';
  end if;
  v_replace := (p ? 'amount' and round((p ->> 'amount')::numeric, 2) is distinct from r.amount)
            or (p ? 'serviceCode' and nullif(p ->> 'serviceCode', '') is distinct from r.service_code)
            or (p ? 'scopeType' and p ->> 'scopeType' is distinct from r.scope_type)
            or (p ? 'scopeValue' and nullif(p ->> 'scopeValue', '') is distinct from r.scope_value);
  if not v_replace then
    if p ? 'name' and coalesce(length(btrim(p ->> 'name')), 0) not between 1 and 120 then
      raise exception 'VALIDATION_ERROR: Give the rule a name.' using errcode = 'P0001';
    end if;
    begin
      update public.incentive_rules
         set name = case when p ? 'name' then btrim(p ->> 'name') else name end,
             target_units = case when p ? 'targetUnits' then nullif(p ->> 'targetUnits', '')::integer else target_units end,
             monthly_cap = case when p ? 'monthlyCap' then nullif(p ->> 'monthlyCap', '')::numeric else monthly_cap end
       where id = r.id returning * into r;
    exception when invalid_text_representation or check_violation or numeric_value_out_of_range then
      raise exception 'VALIDATION_ERROR: Enter the target as a whole number above zero and the cap as an amount above zero.' using errcode = 'P0001';
    end;
    perform private.write_audit('INCENTIVE_RULE_UPDATED', 'incentive_rule', r.id, null, null, jsonb_build_object('changes', p, 'replaced', false));
    return private.incentive_rule_json(r);
  end if;
  -- a new amount / product / audience: the old version ends now and a new one starts (earnings already recorded stay as they were)
  v_spec := jsonb_build_object('name', r.name, 'eventType', r.event_type, 'serviceCode', r.service_code, 'amount', r.amount,
              'targetUnits', r.target_units, 'scopeType', r.scope_type, 'scopeValue', r.scope_value, 'monthlyCap', r.monthly_cap) || p;
  if r.event_type = 'SALE_PAID' and v_spec ->> 'scopeValue' is not distinct from r.scope_value
     and nullif(v_spec ->> 'serviceCode', '') is not distinct from r.service_code then
    -- same Operations Head and product: the amounts already passed down carry over (capped at the new amount)
    v_new := public.incentive_rule_create(v_spec || jsonb_build_object('replacesRuleId', r.id));
  else
    -- a different product or Operations Head (or an event reward): a fresh rule; amounts are passed down again
    update public.incentive_rules set ended_at = now() where id = r.id;
    v_new := public.incentive_rule_create(v_spec - 'replacesRuleId');
  end if;
  perform private.write_audit('INCENTIVE_RULE_UPDATED', 'incentive_rule', r.id, null, null, jsonb_build_object('changes', p, 'replaced', true, 'newRuleId', v_new));
  return (select private.incentive_rule_json(x) from public.incentive_rules x where x.id = v_new);
end $$;
revoke all on function public.incentive_rule_update(uuid, jsonb) from public, anon;
grant execute on function public.incentive_rule_update(uuid, jsonb) to authenticated;

create or replace function public.incentive_rule_delete(p_rule uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_incentive_admin();
  r public.incentive_rules;
begin
  select * into r from public.incentive_rules where id = p_rule;
  if r.id is null then
    raise exception 'NOT_FOUND: This rule does not exist.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.earnings where rule_id = r.id) then
    update public.incentive_rules set ended_at = coalesce(ended_at, now()) where id = r.id;
    perform private.write_audit('INCENTIVE_RULE_DELETED', 'incentive_rule', r.id, null, null, jsonb_build_object('name', r.name, 'stoppedOnly', true));
    return jsonb_build_object('id', r.id, 'deleted', false, 'ended', true);
  end if;
  delete from public.incentive_rules where id = r.id;
  perform private.write_audit('INCENTIVE_RULE_DELETED', 'incentive_rule', r.id, null, null, jsonb_build_object('name', r.name, 'stoppedOnly', false));
  return jsonb_build_object('id', r.id, 'deleted', true, 'ended', false);
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
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                            from public.profiles p join public.teams t on t.id = p.team_id
                           where t.division = 'SALES' and p.status = 'ACTIVE'), '[]'::jsonb)) end);
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
