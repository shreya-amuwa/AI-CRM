-- =============================================================================
-- Employee Wallet (phase 1): one place where every employee sees what they earned, what is theirs to withdraw and what is on its way.
-- Run after 20270205000100_notice_board_delete.sql. Safe to run twice. Nothing is deleted; no existing earning, payout or salary changes.
--
-- THE WALLET IS A VIEW OVER THE MONEY THAT ALREADY EXISTS, NOT A SECOND LEDGER.
--   * Incentives: public.earnings (20270119000100). They are credited the moment a rule triggers (for example when Accounts verifies a customer payment) and
--     are reversed the same way. The wallet shows each as "Incentive Credit" (and a "Reversal" when it is undone). There is no approval stage for them.
--   * Withdrawals: public.payout_requests (20270123000100 / 20270125000100): the employee asks, Accounts approves and pays (by hand or Razorpay), or rejects.
--     Nothing about that flow changes; the wallet shows its requests as "Withdrawal Request" / "Withdrawal Payment".
--   * Salary: the CRM has no payroll yet. The wallet shows the monthly salary on the HR record (hr_employees.monthly_salary, free text) as EXPECTED salary,
--     marked "not credited, not withdrawable". Salary credits arrive with the payroll phase.
--   * NEW here, because nothing recorded them: public.wallet_credits, a manual BONUS, ADJUSTMENT (up or down) or REFUND for one employee, entered by Accounts
--     (or the Super Admin) and approved by a DIFFERENT Accounts person (never the beneficiary). Only a CREDITED one is part of the balance.
--
-- THE LEDGER (public.wallet_transactions) IS DERIVED, NEVER TYPED IN: every row comes from earnings, wallet_credits or payout_requests, so the balance cannot
-- be changed without leaving one of those records, and the sum of the ledger always equals the balance (a test checks it). Each of those records is already
-- audited; wallet_credits is audited here (WALLET_CREDIT_CREATED / _CREDITED / _REJECTED).
--
-- BALANCE.  balance   = credited incentives + credited wallet credits - paid withdrawals          (a clawback can make it negative, as before)
--           available = balance - the open withdrawal request                                      (what may be requested; private.payout_available)
-- private.payout_available now also counts credited wallet credits (a bonus is withdrawable; salary and pending items are not). Withdrawal rules (opens
-- 15 days after the HR joining date, minimum 500, one open request, never more than available, re-checked under a row lock) are unchanged.
--
-- WHO.  An employee reads only their own wallet. Accounts (and the Super Admin) enter and approve wallet credits; Accounts, HR and the Super Admin read the
-- wallet report. No Team Lead or Department Head gets anyone's financial data from this migration.
-- NOTIFICATIONS (bell + push through the existing notification system, once per event): incentive credited / reversed, bonus or adjustment credited,
-- withdrawal submitted / approved (processing); withdrawal paid and rejected are the existing PAYOUT_PAID / PAYOUT_REJECTED.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Manual wallet credits (bonus, adjustment, refund)
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_credits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('BONUS', 'ADJUSTMENT', 'REFUND')),
  amount numeric(14, 2) not null check (amount <> 0 and abs(amount) <= 10000000 and (kind = 'ADJUSTMENT' or amount > 0)),
  description text not null check (length(btrim(description)) between 3 and 300),
  reference text check (reference is null or length(reference) between 1 and 120),
  status text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL', 'CREDITED', 'REJECTED')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  department_id uuid references public.departments (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  request_id text not null unique check (length(request_id) between 8 and 80)
);
-- the same bonus (same reference) is never credited to the same person twice
create unique index if not exists wallet_credits_reference_key on public.wallet_credits (profile_id, kind, reference) where reference is not null;
create index if not exists wallet_credits_person_idx on public.wallet_credits (profile_id, created_at desc);
create index if not exists wallet_credits_status_idx on public.wallet_credits (status, created_at desc);
alter table public.wallet_credits enable row level security;
revoke all on public.wallet_credits from public, anon, authenticated;

-- A credit is decided once and never edited; nothing is deleted (the ledger and the audit trail keep every one).
create or replace function private.tg_wallet_credits_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'FORBIDDEN: Wallet credits are never deleted.' using errcode = '42501';
  end if;
  if old.status <> 'PENDING_APPROVAL' then
    raise exception 'CONFLICT: This wallet credit was already decided.' using errcode = 'P0001';
  end if;
  if (new.profile_id, new.kind, new.amount, new.created_by, new.request_id, new.description, new.reference)
     is distinct from (old.profile_id, old.kind, old.amount, old.created_by, old.request_id, old.description, old.reference) then
    raise exception 'FORBIDDEN: A wallet credit cannot be changed, only approved or rejected.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_wallet_credits_guard() from public, anon, authenticated;
drop trigger if exists wallet_credits_guard on public.wallet_credits;
create trigger wallet_credits_guard before update or delete on public.wallet_credits for each row execute function private.tg_wallet_credits_guard();

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The first number in a free-text amount ("₹25,000", "25000 per month"); null when there is none or it is absurd.
create or replace function private.wallet_amount(p text)
returns numeric language sql immutable set search_path = '' as $$
  select case when m is null or length(replace(m[1], ',', '')) > 10 then null else replace(m[1], ',', '')::numeric end
    from (select regexp_match(coalesce(p, ''), '([0-9][0-9,]*(?:\.[0-9]+)?)') as m) x
$$;
revoke all on function private.wallet_amount(text) from public, anon, authenticated;

-- A notification row for one person, once per dedupe key. Unlike private.notify it also tells the person when they themselves acted (their own withdrawal,
-- an incentive from their own completed demo): it is their money.
create or replace function private.wallet_notify(p_recipient uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
  select p_recipient, p_type, p_title, coalesce(p_body, ''), p_entity_type, p_entity_id, (select id from public.profiles where id = auth.uid()),
         jsonb_build_object('dedupeKey', p_dedupe), 'normal'
   where p_recipient is not null
  on conflict (recipient_id, (data ->> 'dedupeKey')) where data ? 'dedupeKey' do nothing
$$;
revoke all on function private.wallet_notify(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

-- Accounts staff and the Super Admin enter and decide wallet credits
create or replace function private.wallet_admin()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can enter or approve wallet credits.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.wallet_admin() from public, anon, authenticated;

-- Reports: Accounts, HR and the Super Admin
create or replace function private.wallet_reader()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or not (private.is_accounts_staff() or private.is_hr_staff()) then
    raise exception 'FORBIDDEN: Only Accounts, HR and the Super Admin can see wallet reports.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.wallet_reader() from public, anon, authenticated;

create or replace function private.wallet_credited(p uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.wallet_credits where profile_id = p and status = 'CREDITED'
$$;
revoke all on function private.wallet_credited(uuid) from public, anon, authenticated;

-- What may be requested: credited incentives + credited wallet credits - paid and open withdrawals (may be negative after a clawback).
-- (the same function as 20270123000100 with the wallet credits added)
create or replace function private.payout_available(p uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount) from public.earnings where profile_id = p and status = 'EARNED'), 0)
       + private.wallet_credited(p)
       - coalesce((select sum(amount) from public.payout_requests where profile_id = p and status in ('PAID', 'REQUESTED', 'PROCESSING')), 0)
$$;
revoke all on function private.payout_available(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The employee's own wallet
-- ---------------------------------------------------------------------------
create or replace function public.wallet_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
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

-- The ledger: every movement of the person's money, newest first. Derived from earnings, wallet_credits and payout_requests (nothing is typed in).
--   counts_in_balance: it is part of the balance (credited incentives and their reversals, credited wallet credits, paid withdrawals);
--   an open withdrawal is reserved (it is taken off "available" but not off the balance until paid); pending, rejected and cancelled ones count for nothing.
create or replace function public.wallet_transactions(p_from date default null, p_to date default null, p_type text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
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

-- The monthly earnings summary (Indian calendar months, newest first)
create or replace function public.wallet_monthly(p_months integer default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
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

-- ---------------------------------------------------------------------------
-- 4. Wallet credits: Accounts enters one, a different Accounts person approves it
-- ---------------------------------------------------------------------------
create or replace function private.wallet_credit_json(w public.wallet_credits)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', w.id, 'profileId', w.profile_id, 'name', p.full_name, 'department', d.name, 'kind', w.kind, 'amount', w.amount,
           'description', w.description, 'reference', w.reference, 'status', w.status, 'createdAt', w.created_at,
           'createdBy', (select x.full_name from public.profiles x where x.id = w.created_by), 'decidedAt', w.decided_at,
           'decidedBy', (select x.full_name from public.profiles x where x.id = w.decided_by), 'decisionNote', w.decision_note)
    from (select 1) one left join public.profiles p on p.id = w.profile_id left join public.departments d on d.id = private.base_department(p.department_id)
$$;
revoke all on function private.wallet_credit_json(public.wallet_credits) from public, anon, authenticated;

-- people Accounts can credit (active employees; never the Super Admin)
create or replace function public.wallet_people(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.wallet_admin();
  if v_q is null or length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'email', x.email, 'role', x.role,
             'department', (select d.name from public.departments d where d.id = private.base_department(x.department_id))) order by x.full_name)
      from (select p.* from public.profiles p
             where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN' and (p.full_name ilike '%' || private.like_escape(v_q) || '%' or p.email ilike '%' || private.like_escape(v_q) || '%')
             order by p.full_name limit 20) x), '[]'::jsonb);
end $$;
revoke all on function public.wallet_people(text) from public, anon;
grant execute on function public.wallet_people(text) to authenticated;

create or replace function private.wallet_notify_admins(p_type text, p_title text, p_body text, p_entity uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v uuid;
begin
  for v in select p.id from public.profiles p join public.departments d on d.id = p.department_id where p.status = 'ACTIVE' and d.slug = 'accounts' and p.id is distinct from auth.uid() loop
    perform private.wallet_notify(v, p_type, p_title, p_body, 'wallet_credit', p_entity, 'WALLETADMIN|' || p_type || '|' || p_entity || '|' || v);
  end loop;
end $$;
revoke all on function private.wallet_notify_admins(text, text, text, uuid) from public, anon, authenticated;

create or replace function public.wallet_credit_create(p_profile uuid, p_kind text, p_amount numeric, p_description text, p_reference text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_admin();
  b public.profiles;
  w public.wallet_credits;
  v_amount numeric := round(p_amount, 2);
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_desc text := btrim(coalesce(p_description, ''));
begin
  if p_request_id is null or length(p_request_id) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Send the form again.' using errcode = 'P0001';
  end if;
  -- the same form sent twice is the same credit
  select * into w from public.wallet_credits where request_id = p_request_id;
  if w.id is not null then
    if w.created_by is distinct from me.id then
      raise exception 'CONFLICT: Send the form again.' using errcode = 'P0001';
    end if;
    return private.wallet_credit_json(w);
  end if;
  if p_kind is null or p_kind not in ('BONUS', 'ADJUSTMENT', 'REFUND') then
    raise exception 'VALIDATION_ERROR: Choose Bonus, Adjustment or Refund.' using errcode = 'P0001';
  end if;
  if v_amount is null or v_amount = 0 or abs(v_amount) > 10000000 then
    raise exception 'VALIDATION_ERROR: Enter an amount (up to 1 crore).' using errcode = 'P0001';
  end if;
  if p_kind <> 'ADJUSTMENT' and v_amount < 0 then
    raise exception 'VALIDATION_ERROR: A bonus or a refund is a positive amount. Use an Adjustment to take money off.' using errcode = 'P0001';
  end if;
  if length(v_desc) not between 3 and 300 then
    raise exception 'VALIDATION_ERROR: Say what it is for (3 to 300 characters).' using errcode = 'P0001';
  end if;
  if v_ref is not null and length(v_ref) > 120 then
    raise exception 'VALIDATION_ERROR: The reference can have at most 120 characters.' using errcode = 'P0001';
  end if;
  select * into b from public.profiles where id = p_profile;
  if b.id is null or b.status <> 'ACTIVE' or b.role = 'SUPER_ADMIN' then
    raise exception 'VALIDATION_ERROR: Choose an active employee.' using errcode = 'P0001';
  end if;
  if b.id = me.id then
    raise exception 'FORBIDDEN: You cannot credit your own wallet.' using errcode = '42501';
  end if;
  begin
    insert into public.wallet_credits (profile_id, kind, amount, description, reference, created_by, department_id, team_id, request_id)
    values (b.id, p_kind, v_amount, v_desc, v_ref, me.id, b.department_id, b.team_id, p_request_id) returning * into w;
  exception when unique_violation then
    select * into w from public.wallet_credits where request_id = p_request_id and created_by = me.id;
    if w.id is not null then
      return private.wallet_credit_json(w);
    end if;
    raise exception 'CONFLICT: This reference was already used for this employee.' using errcode = 'P0001';
  end;
  perform private.write_audit('WALLET_CREDIT_CREATED', 'wallet_credit', w.id, b.department_id, b.team_id,
    jsonb_build_object('employee', b.id, 'kind', p_kind, 'amount', v_amount, 'reference', v_ref));
  perform private.wallet_notify_admins('WALLET_CREDIT_PENDING', 'Wallet credit to approve',
    format('%s entered a %s of ₹%s for %s. A different Accounts person approves it.', me.full_name, lower(p_kind), to_char(v_amount, 'FM99,99,99,990.00'), b.full_name), w.id);
  return private.wallet_credit_json(w);
end $$;
revoke all on function public.wallet_credit_create(uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.wallet_credit_create(uuid, text, numeric, text, text, text) to authenticated;

create or replace function public.wallet_credit_queue(p_status text default 'PENDING_APPROVAL', p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.wallet_admin();
  if p_status is not null and p_status not in ('PENDING_APPROVAL', 'CREDITED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.wallet_credit_json(w) order by w.created_at desc)
                     from (select * from public.wallet_credits where p_status is null or status = p_status order by created_at desc
                            limit least(greatest(coalesce(p_limit, 50), 1), 200)) w), '[]'::jsonb);
end $$;
revoke all on function public.wallet_credit_queue(text, integer) from public, anon;
grant execute on function public.wallet_credit_queue(text, integer) to authenticated;

create or replace function public.wallet_credit_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_admin();
  w public.wallet_credits;
  b public.profiles;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_title text;
begin
  select * into w from public.wallet_credits where id = p_id for update;
  if w.id is null then
    raise exception 'NOT_FOUND: Wallet credit not found.' using errcode = 'P0002';
  end if;
  -- a different person decides: not the one who entered it, never the one who receives it
  if w.created_by = me.id then
    raise exception 'FORBIDDEN: A different Accounts person must approve a credit you entered.' using errcode = '42501';
  end if;
  if w.profile_id = me.id then
    raise exception 'FORBIDDEN: You cannot decide a credit to your own wallet.' using errcode = '42501';
  end if;
  if w.status <> 'PENDING_APPROVAL' then
    raise exception 'CONFLICT: This wallet credit was already decided.' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'VALIDATION_ERROR: The note can have at most 500 characters.' using errcode = 'P0001';
  end if;
  select * into b from public.profiles where id = w.profile_id;
  if p_approve then
    -- serialise with the person's withdrawals (payout_request locks the same row): a deduction can never leave a negative balance
    perform 1 from public.profiles where id = w.profile_id for update;
    if w.amount < 0 and private.payout_available(w.profile_id) + w.amount < 0 then
      raise exception 'CONFLICT: This adjustment would make the wallet negative (available ₹%).', greatest(private.payout_available(w.profile_id), 0) using errcode = 'P0001';
    end if;
    update public.wallet_credits set status = 'CREDITED', decided_by = me.id, decided_at = now(), decision_note = v_note where id = w.id returning * into w;
    perform private.write_audit('WALLET_CREDIT_CREDITED', 'wallet_credit', w.id, b.department_id, b.team_id,
      jsonb_build_object('employee', b.id, 'kind', w.kind, 'amount', w.amount));
    v_title := case when w.amount < 0 then format('Wallet adjusted: -₹%s', to_char(-w.amount, 'FM99,99,99,990.00'))
                    else format('%s credited to your wallet: ₹%s', initcap(lower(w.kind)), to_char(w.amount, 'FM99,99,99,990.00')) end;
    perform private.wallet_notify(w.profile_id, 'WALLET_CREDIT_CREDITED', v_title, w.description, 'wallet', null, 'WALLETCREDIT|' || w.id);
  else
    if v_note is null then
      raise exception 'VALIDATION_ERROR: Say why you reject it.' using errcode = 'P0001';
    end if;
    update public.wallet_credits set status = 'REJECTED', decided_by = me.id, decided_at = now(), decision_note = v_note where id = w.id returning * into w;
    perform private.write_audit('WALLET_CREDIT_REJECTED', 'wallet_credit', w.id, b.department_id, b.team_id,
      jsonb_build_object('employee', b.id, 'kind', w.kind, 'amount', w.amount, 'note', v_note));
    perform private.wallet_notify(w.created_by, 'WALLET_CREDIT_REJECTED', 'Wallet credit rejected', format('%s for %s: %s', initcap(lower(w.kind)), b.full_name, v_note),
      'wallet_credit', w.id, 'WALLETCREDITREJ|' || w.id);
  end if;
  return private.wallet_credit_json(w);
end $$;
revoke all on function public.wallet_credit_decide(uuid, boolean, text) from public, anon;
grant execute on function public.wallet_credit_decide(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reports for Accounts, HR and the Super Admin
-- ---------------------------------------------------------------------------
create or replace function public.wallet_report(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_to date := coalesce(p_to, private.office_today());
  v_from date := coalesce(p_from, date_trunc('month', coalesce(p_to, private.office_today()))::date);
begin
  perform private.wallet_reader();
  if v_to < v_from or v_to - v_from > 400 then
    raise exception 'VALIDATION_ERROR: Choose a period of at most 400 days.' using errcode = 'P0001';
  end if;
  return (
    with emp as (select p.id, p.full_name, private.base_department(p.department_id) as dept from public.profiles p where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'),
    inc as (select e.profile_id, sum(e.amount) filter (where e.status = 'EARNED' and (e.earned_at at time zone 'Asia/Kolkata')::date between v_from and v_to) as credited,
                   sum(e.amount) filter (where e.status = 'REVERSED' and (coalesce(e.reversed_at, e.earned_at) at time zone 'Asia/Kolkata')::date between v_from and v_to) as reversed
              from public.earnings e group by e.profile_id),
    cr as (select w.profile_id, sum(w.amount) filter (where w.status = 'CREDITED' and (w.decided_at at time zone 'Asia/Kolkata')::date between v_from and v_to) as credited
             from public.wallet_credits w group by w.profile_id),
    wd as (select q.profile_id, sum(q.amount) filter (where q.status = 'PAID' and (coalesce(q.decided_at, q.requested_at) at time zone 'Asia/Kolkata')::date between v_from and v_to) as paid
             from public.payout_requests q group by q.profile_id),
    rw as (select emp.id, emp.full_name as name, emp.dept, coalesce(inc.credited, 0) as incentives, coalesce(inc.reversed, 0) as reversed, coalesce(cr.credited, 0) as credits,
                    coalesce(wd.paid, 0) as withdrawn, private.payout_available(emp.id) as available
               from emp left join inc on inc.profile_id = emp.id left join cr on cr.profile_id = emp.id left join wd on wd.profile_id = emp.id)
    select jsonb_build_object(
      'from', v_from, 'to', v_to,
      -- the salary the HR records say is payable each month (free text on the HR record; people without a figure are counted)
      'salary', jsonb_build_object(
        'monthlyPayable', coalesce((select sum(private.wallet_amount(h.monthly_salary)) from public.hr_employees h join emp on emp.id = h.profile_id), 0),
        'employeesWithSalary', (select count(*) from public.hr_employees h join emp on emp.id = h.profile_id where private.wallet_amount(h.monthly_salary) is not null),
        'employeesWithoutSalary', (select count(*) from emp where not exists (select 1 from public.hr_employees h where h.profile_id = emp.id and private.wallet_amount(h.monthly_salary) is not null)),
        'payrollTracked', false),
      'incentives', jsonb_build_object('generated', coalesce((select sum(incentives) from rw), 0), 'reversed', coalesce((select sum(reversed) from rw), 0),
        'pendingApproval', 0, 'credited', coalesce((select sum(incentives) from rw), 0) - coalesce((select sum(reversed) from rw), 0)),
      'credits', jsonb_build_object('pendingCount', (select count(*) from public.wallet_credits where status = 'PENDING_APPROVAL'),
        'pendingAmount', coalesce((select sum(amount) from public.wallet_credits where status = 'PENDING_APPROVAL'), 0), 'credited', coalesce((select sum(credits) from rw), 0)),
      'withdrawals', jsonb_build_object(
        'requestedCount', (select count(*) from public.payout_requests where (requested_at at time zone 'Asia/Kolkata')::date between v_from and v_to),
        'requestedAmount', coalesce((select sum(amount) from public.payout_requests where (requested_at at time zone 'Asia/Kolkata')::date between v_from and v_to), 0),
        'pendingCount', (select count(*) from public.payout_requests where status in ('REQUESTED', 'PROCESSING')),
        'pendingAmount', coalesce((select sum(amount) from public.payout_requests where status in ('REQUESTED', 'PROCESSING')), 0),
        'paidCount', (select count(*) from public.payout_requests where status = 'PAID' and (coalesce(decided_at, requested_at) at time zone 'Asia/Kolkata')::date between v_from and v_to),
        'paidAmount', coalesce((select sum(withdrawn) from rw), 0),
        'rejectedCount', (select count(*) from public.payout_requests where status in ('REJECTED', 'CANCELLED', 'FAILED') and (requested_at at time zone 'Asia/Kolkata')::date between v_from and v_to)),
      'departments', coalesce((select jsonb_agg(jsonb_build_object('departmentId', x.dept, 'department', coalesce(d.name, 'No department'), 'employees', x.n, 'incentives', x.inc, 'credits', x.cr, 'withdrawn', x.wd) order by x.inc desc, d.name)
                                 from (select dept, count(*) n, sum(incentives - reversed) inc, sum(credits) cr, sum(withdrawn) wd from rw group by dept) x left join public.departments d on d.id = x.dept), '[]'::jsonb),
      'employees', coalesce((select jsonb_agg(jsonb_build_object('profileId', r.id, 'name', r.name, 'department', (select d.name from public.departments d where d.id = r.dept),
                                'incentives', r.incentives - r.reversed, 'credits', r.credits, 'withdrawn', r.withdrawn, 'available', greatest(r.available, 0)) order by r.incentives - r.reversed + r.credits desc, r.name)
                               from (select * from rw where incentives <> 0 or reversed <> 0 or credits <> 0 or withdrawn <> 0 order by incentives - reversed + credits desc, name limit 200) r), '[]'::jsonb),
      'months', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(m.d, 'YYYY-MM'),
                  'incentives', coalesce((select sum(e.amount) from public.earnings e where e.status = 'EARNED' and date_trunc('month', e.earned_at at time zone 'Asia/Kolkata') = m.d), 0),
                  'credits', coalesce((select sum(w.amount) from public.wallet_credits w where w.status = 'CREDITED' and date_trunc('month', w.decided_at at time zone 'Asia/Kolkata') = m.d), 0),
                  'withdrawn', coalesce((select sum(q.amount) from public.payout_requests q where q.status = 'PAID' and date_trunc('month', coalesce(q.decided_at, q.requested_at) at time zone 'Asia/Kolkata') = m.d), 0))
                  order by m.d desc)
                from generate_series(date_trunc('month', private.office_today()::timestamp) - interval '11 months', date_trunc('month', private.office_today()::timestamp), interval '1 month') as m(d)), '[]'::jsonb)));
end $$;
revoke all on function public.wallet_report(date, date) from public, anon;
grant execute on function public.wallet_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Notifications (one per event, kept in the bell even when the person is offline). A problem here never blocks Accounts or the withdrawal.
-- ---------------------------------------------------------------------------
create or replace function private.tg_wallet_earning_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_what text;
begin
  begin
    select concat_ws(' · ', r.name, s.name) into v_what from public.incentive_rules r left join public.crm_services s on s.code = new.service_code where r.id = new.rule_id;
    if tg_op = 'INSERT' then
      perform private.wallet_notify(new.profile_id, 'WALLET_INCENTIVE_CREDITED', format('Incentive credited to your wallet: ₹%s', to_char(new.amount, 'FM99,99,99,990.00')),
        coalesce(v_what, 'Incentive'), 'wallet', null, 'WALLETEARN|' || new.id);
    elsif new.status = 'REVERSED' and old.status is distinct from 'REVERSED' then
      perform private.wallet_notify(new.profile_id, 'WALLET_INCENTIVE_REVERSED', format('Incentive reversed: ₹%s', to_char(new.amount, 'FM99,99,99,990.00')),
        coalesce(v_what, 'Incentive') || ' · the payment was reversed.', 'wallet', null, 'WALLETEARNREV|' || new.id);
    end if;
  exception when others then
    raise warning 'wallet: could not notify about earning %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_wallet_earning_notify() from public, anon, authenticated;
drop trigger if exists wallet_earning_notify on public.earnings;
create trigger wallet_earning_notify after insert or update of status on public.earnings for each row execute function private.tg_wallet_earning_notify();

create or replace function private.tg_wallet_withdrawal_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'INSERT' and new.status = 'REQUESTED' and not new.final_settlement then
      perform private.wallet_notify(new.profile_id, 'WALLET_WITHDRAWAL_SUBMITTED', format('Withdrawal request submitted: ₹%s', to_char(new.amount, 'FM99,99,99,990.00')),
        'Accounts will review it. You will be told when it is approved or rejected.', 'wallet', null, 'WALLETWD|' || new.id);
    elsif tg_op = 'UPDATE' and new.status = 'PROCESSING' and old.status is distinct from 'PROCESSING' then
      perform private.wallet_notify(new.profile_id, 'WALLET_WITHDRAWAL_APPROVED', format('Withdrawal approved: ₹%s', to_char(new.amount, 'FM99,99,99,990.00')),
        'Your payment is being processed.', 'wallet', null, 'WALLETWDOK|' || new.id);
    end if;
  exception when others then
    raise warning 'wallet: could not notify about withdrawal %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_wallet_withdrawal_notify() from public, anon, authenticated;
drop trigger if exists wallet_withdrawal_notify on public.payout_requests;
create trigger wallet_withdrawal_notify after insert or update of status on public.payout_requests for each row execute function private.tg_wallet_withdrawal_notify();

notify pgrst, 'reload schema';
