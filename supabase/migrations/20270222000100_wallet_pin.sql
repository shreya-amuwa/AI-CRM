-- =============================================================================
-- Wallet PIN (docs/EMPLOYEE_WALLET.md "Wallet PIN"; design docs/superpowers/specs/2026-11-26-wallet-pin-design.md). Run after every earlier
-- migration. Safe to run twice; no data is changed.
--
-- Every employee sets a 6-digit Wallet PIN the first time they open the Wallet and enters it once per sign-in. The PIN is stored only as a bcrypt
-- hash; 5 wrong PINs lock the Wallet for 15 minutes. An unlock is kept per person AND sign-in session (the JWT's session_id) for 15 minutes,
-- renewed while the Wallet is used, so signing in again (another session) asks for the PIN again. The Wallet's own functions (wallet_summary,
-- wallet_transactions, wallet_monthly) now refuse with WALLET_LOCKED until then: the browser cannot skip the PIN.
-- Forgot PIN: the API (service role) asks wallet_pin_reset_begin for a one-time 8-character code and e-mails it to the person; they type it with a
-- new PIN (wallet_pin_reset_finish). 30 minutes, 5 tries, one use. The Super Admin has no employee wallet and needs no PIN.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.wallet_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  failed_count integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.wallet_unlocks (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_id text not null check (length(session_id) between 1 and 200),
  expires_at timestamptz not null,
  primary key (profile_id, session_id)
);
create table if not exists public.wallet_pin_resets (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  tries integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.wallet_pins enable row level security;
alter table public.wallet_unlocks enable row level security;
alter table public.wallet_pin_resets enable row level security;
revoke all on public.wallet_pins, public.wallet_unlocks, public.wallet_pin_resets from public, anon, authenticated;

-- the sign-in session of this request (Supabase puts session_id in every access token); null = no unlock is possible
create or replace function private.wallet_session()
returns text language sql stable set search_path = '' as $$
  select nullif(btrim(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')), '')
$$;
revoke all on function private.wallet_session() from public, anon, authenticated;

-- the signed-in employee (an active person with a wallet: everyone but the Super Admin)
create or replace function private.wallet_pin_me()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if me.role = 'SUPER_ADMIN' then
    raise exception 'CONFLICT: The Managing Director has no employee wallet and no wallet PIN.' using errcode = 'P0001';
  end if;
  return me;
end $$;
revoke all on function private.wallet_pin_me() from public, anon, authenticated;

create or replace function private.wallet_pin_check(p_pin text, p_confirm text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'VALIDATION_ERROR: The PIN must be exactly 6 digits.' using errcode = 'P0001';
  end if;
  if p_confirm is distinct from p_pin then
    raise exception 'VALIDATION_ERROR: The two PINs do not match.' using errcode = 'P0001';
  end if;
  if p_pin ~ '^(.)\1{5}$' or p_pin in ('123456', '654321', '012345', '543210') then
    raise exception 'VALIDATION_ERROR: Choose a PIN that is harder to guess (not the same digit six times or a simple sequence).' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.wallet_pin_check(text, text) from public, anon, authenticated;

create or replace function private.wallet_pin_grant(p_profile uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_sid text := private.wallet_session();
  v_until timestamptz := now() + interval '15 minutes';
begin
  if v_sid is null then return null; end if;
  delete from public.wallet_unlocks where profile_id = p_profile and expires_at < now();
  insert into public.wallet_unlocks (profile_id, session_id, expires_at) values (p_profile, v_sid, v_until)
  on conflict (profile_id, session_id) do update set expires_at = excluded.expires_at;
  return v_until;
end $$;
revoke all on function private.wallet_pin_grant(uuid) from public, anon, authenticated;

create or replace function private.wallet_unlock_until(p_profile uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select u.expires_at from public.wallet_unlocks u
   where u.profile_id = p_profile and u.session_id = private.wallet_session() and u.expires_at > now()
$$;
revoke all on function private.wallet_unlock_until(uuid) from public, anon, authenticated;

-- The Wallet's own reads: the person (as private.payout_me) AND an unlock of this sign-in session, renewed while the wallet is used.
-- Volatile on purpose: it renews the unlock (the wallet functions that call it are stable, which PostgreSQL allows for a volatile callee).
create or replace function private.wallet_me()
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
begin
  if private.wallet_unlock_until(me.id) is null then
    raise exception 'WALLET_LOCKED: Enter your Wallet PIN.' using errcode = 'P0001';
  end if;
  update public.wallet_unlocks set expires_at = now() + interval '15 minutes'
   where profile_id = me.id and session_id = private.wallet_session();
  return me;
end $$;
revoke all on function private.wallet_me() from public, anon, authenticated;

create or replace function public.wallet_pin_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
  p public.wallet_pins;
begin
  select * into p from public.wallet_pins where profile_id = me.id;
  return jsonb_build_object('hasPin', p.profile_id is not null,
    'unlocked', private.wallet_unlock_until(me.id) is not null, 'unlockExpiresAt', private.wallet_unlock_until(me.id),
    'lockedUntil', case when p.locked_until > now() then p.locked_until end,
    'triesLeft', case when p.profile_id is null then 5 else greatest(5 - p.failed_count, 0) end);
end $$;
revoke all on function public.wallet_pin_status() from public, anon;
grant execute on function public.wallet_pin_status() to authenticated;

create or replace function public.wallet_pin_set(p_pin text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
begin
  perform private.wallet_pin_check(p_pin, p_confirm);
  begin
    insert into public.wallet_pins (profile_id, pin_hash) values (me.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)));
  exception when unique_violation then
    raise exception 'CONFLICT: Your Wallet PIN is already set. Use Change PIN or Forgot PIN.' using errcode = 'P0001';
  end;
  perform private.write_audit('WALLET_PIN_SET', 'profile', me.id, me.department_id, me.team_id, '{}'::jsonb);
  return jsonb_build_object('unlocked', private.wallet_pin_grant(me.id) is not null);
end $$;
revoke all on function public.wallet_pin_set(text, text) from public, anon;
grant execute on function public.wallet_pin_set(text, text) to authenticated;

-- a wrong PIN does not raise (the count must be saved); the answer says how many tries are left or until when it is locked
create or replace function public.wallet_pin_unlock(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
  p public.wallet_pins;
begin
  select * into p from public.wallet_pins where profile_id = me.id for update;
  if p.profile_id is null then
    raise exception 'CONFLICT: Set your Wallet PIN first.' using errcode = 'P0001';
  end if;
  if p.locked_until > now() then
    return jsonb_build_object('unlocked', false, 'triesLeft', 0, 'lockedUntil', p.locked_until);
  end if;
  if p_pin is not null and p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin, p.pin_hash) = p.pin_hash then
    update public.wallet_pins set failed_count = 0, locked_until = null, updated_at = now() where profile_id = me.id;
    return jsonb_build_object('unlocked', private.wallet_pin_grant(me.id) is not null, 'triesLeft', 5);
  end if;
  update public.wallet_pins
     set failed_count = case when p.failed_count + 1 >= 5 then 0 else p.failed_count + 1 end,
         locked_until = case when p.failed_count + 1 >= 5 then now() + interval '15 minutes' end,
         updated_at = now()
   where profile_id = me.id returning * into p;
  if p.locked_until is not null then
    perform private.write_audit('WALLET_PIN_LOCKED', 'profile', me.id, me.department_id, me.team_id, '{}'::jsonb);
  end if;
  return jsonb_build_object('unlocked', false, 'triesLeft', case when p.locked_until is not null then 0 else 5 - p.failed_count end, 'lockedUntil', p.locked_until);
end $$;
revoke all on function public.wallet_pin_unlock(text) from public, anon;
grant execute on function public.wallet_pin_unlock(text) to authenticated;

create or replace function public.wallet_pin_change(p_old text, p_new text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
  r jsonb;
begin
  perform private.wallet_pin_check(p_new, p_confirm);
  r := public.wallet_pin_unlock(p_old);
  if not coalesce((r ->> 'unlocked')::boolean, false) then
    return r || jsonb_build_object('changed', false);
  end if;
  update public.wallet_pins set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now() where profile_id = me.id;
  -- other sign-ins must enter the new PIN
  delete from public.wallet_unlocks where profile_id = me.id and session_id is distinct from private.wallet_session();
  perform private.write_audit('WALLET_PIN_CHANGED', 'profile', me.id, me.department_id, me.team_id, '{}'::jsonb);
  return r || jsonb_build_object('changed', true);
end $$;
revoke all on function public.wallet_pin_change(text, text, text) from public, anon;
grant execute on function public.wallet_pin_change(text, text, text) to authenticated;

create or replace function public.wallet_pin_lock()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.wallet_unlocks where profile_id = auth.uid() and session_id = private.wallet_session();
end $$;
revoke all on function public.wallet_pin_lock() from public, anon;
grant execute on function public.wallet_pin_lock() to authenticated;

-- Forgot PIN, step 1: ONLY the API (service role) may call this, for the signed-in person it checked; the code goes out by e-mail, never to the browser
create or replace function public.wallet_pin_reset_begin(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_code text;
  v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_prev public.wallet_pin_resets;
begin
  select * into me from public.profiles where id = p_profile and status = 'ACTIVE';
  if me.id is null then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  if me.role = 'SUPER_ADMIN' then
    raise exception 'CONFLICT: The Managing Director has no employee wallet and no wallet PIN.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.wallet_pins where profile_id = me.id) then
    raise exception 'CONFLICT: You have not set a Wallet PIN yet: open your Wallet to set one.' using errcode = 'P0001';
  end if;
  select * into v_prev from public.wallet_pin_resets where profile_id = me.id;
  if v_prev.created_at > now() - interval '1 minute' then
    raise exception 'CONFLICT: A reset code was sent less than a minute ago. Check your inbox and spam folder.' using errcode = 'P0001';
  end if;
  select string_agg(substr(v_alpha, 1 + (get_byte(b, i) % length(v_alpha)), 1), '' order by i)
    into v_code from (select extensions.gen_random_bytes(8) as b) x, generate_series(0, 7) i;
  insert into public.wallet_pin_resets (profile_id, code_hash, expires_at, tries, created_at)
  values (me.id, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), now() + interval '30 minutes', 0, now())
  on conflict (profile_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, created_at = now();
  perform private.write_audit('WALLET_PIN_RESET_REQUESTED', 'profile', me.id, me.department_id, me.team_id, '{}'::jsonb);
  return jsonb_build_object('code', v_code, 'email', me.email, 'name', me.full_name);
end $$;
revoke all on function public.wallet_pin_reset_begin(uuid) from public, anon, authenticated;
grant execute on function public.wallet_pin_reset_begin(uuid) to service_role;

-- Forgot PIN, step 2: the signed-in person types the e-mailed code and a new PIN
create or replace function public.wallet_pin_reset_finish(p_code text, p_pin text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
  r public.wallet_pin_resets;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
begin
  perform private.wallet_pin_check(p_pin, p_confirm);
  select * into r from public.wallet_pin_resets where profile_id = me.id for update;
  if r.profile_id is null or r.expires_at < now() or r.tries >= 5 then
    raise exception 'CONFLICT: This reset code is not valid any more. Ask for a new one.' using errcode = 'P0001';
  end if;
  if extensions.crypt(v_code, r.code_hash) <> r.code_hash then
    update public.wallet_pin_resets set tries = tries + 1 where profile_id = me.id;
    return jsonb_build_object('reset', false, 'triesLeft', greatest(5 - r.tries - 1, 0));
  end if;
  delete from public.wallet_pin_resets where profile_id = me.id;
  update public.wallet_pins set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), failed_count = 0, locked_until = null, updated_at = now()
   where profile_id = me.id;
  delete from public.wallet_unlocks where profile_id = me.id;
  perform private.write_audit('WALLET_PIN_RESET', 'profile', me.id, me.department_id, me.team_id, '{}'::jsonb);
  return jsonb_build_object('reset', true, 'unlocked', private.wallet_pin_grant(me.id) is not null);
end $$;
revoke all on function public.wallet_pin_reset_finish(text, text, text) from public, anon;
grant execute on function public.wallet_pin_reset_finish(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The Wallet's own reads, unchanged except that they need the unlock (private.payout_me() -> private.wallet_me())
-- ---------------------------------------------------------------------------
create or replace function public.wallet_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_me();
  v_today date := private.office_today();
  v_month date := date_trunc('month', private.office_today())::date;
  v_earned numeric;
  v_reversed numeric;
  v_inc_month numeric;
  v_withdrawn numeric := private.payout_withdrawn(me.id);
  v_avail numeric := private.payout_available(me.id);
  v_reserved numeric;
  v_opens date := private.payout_opens_on(me.id);
  v_salary_text text;
  v_salary numeric;
begin
  -- the Super Admin owns the company: no wallet, no payroll
  if me.role = 'SUPER_ADMIN' then
    return jsonb_build_object('eligible', false);
  end if;
  select coalesce(sum(amount) filter (where status = 'EARNED'), 0), coalesce(sum(amount) filter (where status = 'REVERSED'), 0),
         coalesce(sum(amount) filter (where status = 'EARNED' and (earned_at at time zone 'Asia/Kolkata')::date >= v_month), 0)
    into v_earned, v_reversed, v_inc_month from public.earnings where profile_id = me.id;
  select coalesce(sum(amount), 0) into v_reserved from public.payout_requests where profile_id = me.id and status in ('REQUESTED', 'PROCESSING');
  select nullif(btrim(h.monthly_salary), '') into v_salary_text from public.hr_employees h where h.profile_id = me.id limit 1;
  v_salary := private.wallet_amount(v_salary_text);
  return jsonb_build_object(
    'eligible', true,
    -- credited incentives + credited wallet credits - what was paid out
    'balance', v_earned + private.wallet_credited(me.id) - v_withdrawn,
    -- what may be requested now (never negative here; a clawback shows as toRecover)
    'availableToWithdraw', greatest(v_avail, 0),
    'toRecover', greatest(-v_avail, 0),
    'reserved', v_reserved,
    'pending', jsonb_build_object(
      'credits', coalesce((select sum(amount) from public.wallet_credits where profile_id = me.id and status = 'PENDING_APPROVAL' and amount > 0), 0),
      'creditCount', (select count(*) from public.wallet_credits where profile_id = me.id and status = 'PENDING_APPROVAL'),
      'withdrawal', v_reserved),
    'thisMonth', jsonb_build_object(
      'incentives', v_inc_month,
      'bonuses', coalesce((select sum(amount) from public.wallet_credits where profile_id = me.id and status = 'CREDITED' and kind = 'BONUS'
                            and (decided_at at time zone 'Asia/Kolkata')::date >= v_month), 0),
      'salaryExpected', v_salary),
    -- incentives are credited as soon as the rule triggers, so none waits for approval; "paidOut" is what has been withdrawn
    'incentives', jsonb_build_object('credited', v_earned, 'reversed', v_reversed, 'pendingApproval', 0, 'approved', 0, 'paidOut', v_withdrawn),
    'bonuses', jsonb_build_object(
      'credited', coalesce((select sum(amount) from public.wallet_credits where profile_id = me.id and status = 'CREDITED' and kind = 'BONUS'), 0),
      'pending', coalesce((select sum(amount) from public.wallet_credits where profile_id = me.id and status = 'PENDING_APPROVAL' and kind = 'BONUS'), 0)),
    'adjustments', jsonb_build_object(
      'net', coalesce((select sum(amount) from public.wallet_credits where profile_id = me.id and status = 'CREDITED' and kind = 'ADJUSTMENT'), 0),
      'refunds', coalesce((select sum(amount) from public.wallet_credits where profile_id = me.id and status = 'CREDITED' and kind = 'REFUND'), 0)),
    -- salary: only what HR recorded. Approved / credited / payment dates and the breakup arrive with payroll; nothing here is withdrawable.
    'salary', jsonb_build_object(
      'monthly', v_salary, 'monthlyText', v_salary_text, 'source', case when v_salary_text is null then null else 'HR_RECORD' end,
      'expected', v_salary, 'approved', null, 'credited', null, 'withdrawable', 0, 'lastPaidOn', null, 'breakup', null, 'history', '[]'::jsonb,
      'payrollTracked', false),
    'withdrawals', jsonb_build_object(
      'total', v_withdrawn, 'minimum', 500, 'opensOn', v_opens, 'open', coalesce(v_opens <= v_today, false),
      'startAfterDays', (select start_after_days from public.incentive_settings where id),
      'openRequest', (select private.payout_request_json(r, true) from public.payout_requests r where r.profile_id = me.id and r.status in ('REQUESTED', 'PROCESSING') limit 1)));
end $$;
revoke all on function public.wallet_summary() from public, anon;
grant execute on function public.wallet_summary() to authenticated;

create or replace function public.wallet_transactions(p_from date default null, p_to date default null, p_type text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_me();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_dept text := (select d.name from public.departments d where d.id = private.base_department(me.department_id));
  v_team text := (select t.name from public.teams t where t.id = me.team_id);
begin
  if me.role = 'SUPER_ADMIN' then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'balance', 0);
  end if;
  if p_type is not null and p_type not in ('SALARY_CREDIT', 'INCENTIVE_CREDIT', 'BONUS_CREDIT', 'WALLET_ADJUSTMENT', 'WITHDRAWAL_REQUEST', 'WITHDRAWAL_PAYMENT', 'REFUND', 'REVERSAL') then
    raise exception 'VALIDATION_ERROR: Unknown transaction type.' using errcode = 'P0001';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  return (
    with l as (
      -- incentives credited
      select 'E-' || e.id::text as id, e.earned_at as at, 'INCENTIVE_CREDIT'::text as type, e.amount as amount, 'CREDITED'::text as status, true as counts,
             e.event_type::text as source, concat_ws(' · ', r.name, s.name, coalesce(nullif(btrim(c.company), ''), c.name)) as description,
             'EARN-' || e.id::text as reference, null::text as created_by, null::text as approved_by, e.earned_at as updated_at
        from public.earnings e join public.incentive_rules r on r.id = e.rule_id
        left join public.customers c on c.id = e.customer_id left join public.crm_services s on s.code = e.service_code
       where e.profile_id = me.id
      union all
      -- incentives undone (the payment was reversed): a reversal that takes the same amount back
      select 'R-' || e.id::text, coalesce(e.reversed_at, e.earned_at), 'REVERSAL', -e.amount, 'POSTED', true,
             e.event_type::text, 'Reversed: ' || concat_ws(' · ', r.name, s.name, coalesce(nullif(btrim(c.company), ''), c.name)),
             'EARN-' || e.id::text, null, null, coalesce(e.reversed_at, e.earned_at)
        from public.earnings e join public.incentive_rules r on r.id = e.rule_id
        left join public.customers c on c.id = e.customer_id left join public.crm_services s on s.code = e.service_code
       where e.profile_id = me.id and e.status = 'REVERSED'
      union all
      -- bonuses, adjustments and refunds
      select 'C-' || w.id::text, coalesce(w.decided_at, w.created_at),
             case w.kind when 'BONUS' then 'BONUS_CREDIT' when 'ADJUSTMENT' then 'WALLET_ADJUSTMENT' else 'REFUND' end,
             w.amount, w.status, w.status = 'CREDITED', 'MANUAL', w.description, w.reference,
             (select p.full_name from public.profiles p where p.id = w.created_by), (select p.full_name from public.profiles p where p.id = w.decided_by),
             coalesce(w.decided_at, w.created_at)
        from public.wallet_credits w where w.profile_id = me.id
      union all
      -- withdrawals: paid ones are the payment, the rest are requests (open ones are reserved)
      select 'W-' || q.id::text, coalesce(case when q.status = 'PAID' then q.decided_at end, q.requested_at),
             case when q.status = 'PAID' then 'WITHDRAWAL_PAYMENT' else 'WITHDRAWAL_REQUEST' end,
             -q.amount, q.status, q.status = 'PAID', 'WITHDRAWAL',
             concat_ws(' · ', case when q.final_settlement then 'Final settlement' else 'Withdrawal' end, nullif(q.reference, ''), case when q.reason is not null then 'Reason: ' || q.reason end),
             q.reference, me.full_name, (select p.full_name from public.profiles p where p.id = q.decided_by), coalesce(q.decided_at, q.requested_at)
        from public.payout_requests q where q.profile_id = me.id),
    f as (
      select * from l
       where (p_type is null or type = p_type)
         and (p_from is null or (at at time zone 'Asia/Kolkata')::date >= p_from)
         and (p_to is null or (at at time zone 'Asia/Kolkata')::date <= p_to))
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', x.id, 'employeeId', me.id, 'type', x.type, 'amount', x.amount, 'status', x.status, 'countsInBalance', x.counts, 'source', x.source,
                 'department', v_dept, 'team', v_team, 'description', x.description, 'date', x.at, 'reference', x.reference,
                 'createdBy', x.created_by, 'approvedBy', x.approved_by, 'updatedAt', x.updated_at) order by x.at desc, x.id)
               from (select * from f order by at desc, id limit v_limit offset v_off) x), '[]'::jsonb),
      'total', (select count(*) from f),
      -- the whole ledger's balance (not just this page): it equals wallet_summary().balance
      'balance', coalesce((select sum(amount) from l where counts), 0)));
end $$;
revoke all on function public.wallet_transactions(date, date, text, integer, integer) from public, anon;
grant execute on function public.wallet_transactions(date, date, text, integer, integer) to authenticated;

create or replace function public.wallet_monthly(p_months integer default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_me();
  v_n integer := least(greatest(coalesce(p_months, 12), 1), 36);
  v_first timestamp := date_trunc('month', private.office_today()::timestamp) - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36) - 1);
begin
  if me.role = 'SUPER_ADMIN' then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('month', to_char(m.d, 'YYYY-MM'),
             'incentives', coalesce((select sum(e.amount) from public.earnings e where e.profile_id = me.id and e.status = 'EARNED'
                                       and date_trunc('month', e.earned_at at time zone 'Asia/Kolkata') = m.d), 0),
             'reversed', coalesce((select sum(e.amount) from public.earnings e where e.profile_id = me.id and e.status = 'REVERSED'
                                     and date_trunc('month', coalesce(e.reversed_at, e.earned_at) at time zone 'Asia/Kolkata') = m.d), 0),
             'bonuses', coalesce((select sum(w.amount) from public.wallet_credits w where w.profile_id = me.id and w.status = 'CREDITED' and w.kind = 'BONUS'
                                    and date_trunc('month', w.decided_at at time zone 'Asia/Kolkata') = m.d), 0),
             'adjustments', coalesce((select sum(w.amount) from public.wallet_credits w where w.profile_id = me.id and w.status = 'CREDITED' and w.kind <> 'BONUS'
                                        and date_trunc('month', w.decided_at at time zone 'Asia/Kolkata') = m.d), 0),
             'withdrawn', coalesce((select sum(q.amount) from public.payout_requests q where q.profile_id = me.id and q.status = 'PAID'
                                      and date_trunc('month', coalesce(q.decided_at, q.requested_at) at time zone 'Asia/Kolkata') = m.d), 0))
           order by m.d desc)
      from generate_series(v_first, date_trunc('month', private.office_today()::timestamp), interval '1 month') as m(d)), '[]'::jsonb);
end $$;
revoke all on function public.wallet_monthly(integer) from public, anon;
grant execute on function public.wallet_monthly(integer) to authenticated;

notify pgrst, 'reload schema';
