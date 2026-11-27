-- =============================================================================
-- Wallet PIN everywhere the person's money is read (PR 2 of the Incentive & Wallet work; docs/EMPLOYEE_WALLET.md "Wallet PIN"). Run after
-- 20270222000100_wallet_pin.sql. Safe to run twice; no data is changed.
--
-- "My Income" leaves the Sales dashboards: everything it showed is in the Wallet. Its database functions stay (nothing is deleted) but, like the
-- Wallet's, they now need the Wallet PIN of this sign-in: income_summary, income_earnings, and the person's own withdrawal functions (through
-- private.payout_me: payout_method_get / save, payout_request, payout_cancel, payout_my_requests).
-- The lock applies once the person has set a PIN. Before that it would protect nothing (setting a PIN needs only the sign-in), and the Wallet asks every
-- employee to set one before it shows anything. Accounts' and HR's functions are unchanged.
-- =============================================================================

-- the person may read their money now: no PIN set yet, or the PIN was entered in this sign-in session
create or replace function private.wallet_pin_ok(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.wallet_pins w where w.profile_id = p_profile) or private.wallet_unlock_until(p_profile) is not null
$$;
revoke all on function private.wallet_pin_ok(uuid) from public, anon, authenticated;

-- the person's own payout functions: the person, and the Wallet PIN when one is set
create or replace function private.payout_me()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if not private.wallet_pin_ok(me.id) then
    raise exception 'WALLET_LOCKED: Enter your Wallet PIN.' using errcode = 'P0001';
  end if;
  return me;
end $$;
revoke all on function private.payout_me() from public, anon, authenticated;

-- the Wallet's own reads (wallet_summary, wallet_transactions, wallet_monthly): as payout_me, and the unlock is renewed while the wallet is used
create or replace function private.wallet_me()
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
begin
  update public.wallet_unlocks set expires_at = now() + interval '15 minutes'
   where profile_id = me.id and session_id = private.wallet_session() and expires_at > now();
  return me;
end $$;
revoke all on function private.wallet_me() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- My Income's reads, unchanged except for the PIN check after the person check
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
  if not private.wallet_pin_ok(me.id) then
    raise exception 'WALLET_LOCKED: Enter your Wallet PIN.' using errcode = 'P0001';
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
      -- earned minus what was paid out (phase 2: 20270123000100); available also takes off the open request
      'balance', coalesce((select sum(amount) from mine), 0) - private.payout_withdrawn(me.id),
      'withdrawn', private.payout_withdrawn(me.id),
      'available', private.payout_available(me.id),
      'withdrawOpensOn', private.payout_opens_on(me.id),
      'withdrawOpen', coalesce(private.payout_opens_on(me.id) <= v_today, false),
      'startAfterDays', (select start_after_days from public.incentive_settings where id),
      'openRequest', (select private.payout_request_json(r, true) from public.payout_requests r
                       where r.profile_id = me.id and r.status in ('REQUESTED', 'PROCESSING') limit 1),
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
  if not private.wallet_pin_ok(me.id) then
    raise exception 'WALLET_LOCKED: Enter your Wallet PIN.' using errcode = 'P0001';
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

notify pgrst, 'reload schema';
