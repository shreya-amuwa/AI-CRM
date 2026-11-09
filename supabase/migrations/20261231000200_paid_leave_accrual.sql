-- =============================================================================
-- Paid leave for confirmed full-time employees: 2 days a month after the probation is APPROVED, unused days carry forward.
--
-- Eligibility comes from the EXISTING probation confirmation (hr_probation_cycles): an APPROVED cycle and its approved effective_date. Nothing
-- turns an employee full-time by itself after six months (a PENDING cycle past its end date earns nothing), and inactive employees earn nothing.
--
-- Stored in an append-only ledger (paid_leave_ledger): monthly credits, approved paid leave, reversals, an HR opening balance and HR
-- corrections. Balances are always the sum of the ledger, computed in the database. Rows are never updated or deleted.
--   * one credit per employee per month (unique key): running the accrual twice credits nothing twice;
--   * a paid leave request reserves its days while it waits (Team Lead / Department Head / Operations Head / HR, the chain is unchanged) and
--     is deducted exactly once when it is finally APPROVED (unique key per request); a rejected request never consumed anything;
--   * half days count 0.5 and Sundays are not counted (the same rule as the existing leave totals);
--   * unpaid leave is unchanged and always possible.
--
-- SWITCHED OFF until HR confirms the policy details (paid_leave_settings.enabled = false): the day of the month the credit is given, how a
-- month in which the confirmation takes effect is treated (from the next full month by default), the first month to credit (no backfill before
-- it), and any opening balances. HR leadership / the Super Admin switch it on (paid_leave_settings_set); every change is audited.
-- Safe to run again; nothing existing is changed (leave_requests only gains a "paid" column that is false for every existing request).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings, the paid flag, the ledger
-- ---------------------------------------------------------------------------
create table if not exists public.paid_leave_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  monthly_days numeric(4, 1) not null default 2 check (monthly_days > 0 and monthly_days <= 10),
  credit_day integer not null default 1 check (credit_day between 1 and 28),
  partial_month_rule text not null default 'NEXT_FULL_MONTH' check (partial_month_rule in ('NEXT_FULL_MONTH', 'EFFECTIVE_MONTH')),
  accrual_start_month date check (accrual_start_month is null or accrual_start_month = date_trunc('month', accrual_start_month)::date),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.paid_leave_settings (id) values (true) on conflict (id) do nothing;
alter table public.paid_leave_settings enable row level security;
revoke all on public.paid_leave_settings from anon, authenticated;

alter table public.leave_requests add column if not exists paid boolean not null default false;

create table if not exists public.paid_leave_ledger (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  entry_type text not null check (entry_type in ('MONTHLY_CREDIT', 'LEAVE_DEBIT', 'LEAVE_REVERSAL', 'OPENING_BALANCE', 'CORRECTION')),
  days numeric(5, 1) not null check (days <> 0 and abs(days) <= 400),
  -- the month an entry counts in: the credited month for a credit, the month it was recorded (IST) for everything else
  entry_month date not null,
  leave_request_id uuid references public.leave_requests (id) on delete set null,
  note text check (note is null or length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((entry_type = 'MONTHLY_CREDIT' and days > 0) or (entry_type = 'LEAVE_DEBIT' and days < 0) or (entry_type = 'LEAVE_REVERSAL' and days > 0)
         or entry_type in ('OPENING_BALANCE', 'CORRECTION'))
);
create unique index if not exists paid_leave_ledger_one_credit on public.paid_leave_ledger (profile_id, entry_month) where entry_type = 'MONTHLY_CREDIT';
create unique index if not exists paid_leave_ledger_one_debit on public.paid_leave_ledger (leave_request_id) where entry_type = 'LEAVE_DEBIT';
create unique index if not exists paid_leave_ledger_one_reversal on public.paid_leave_ledger (leave_request_id) where entry_type = 'LEAVE_REVERSAL';
create unique index if not exists paid_leave_ledger_one_opening on public.paid_leave_ledger (profile_id) where entry_type = 'OPENING_BALANCE';
create index if not exists paid_leave_ledger_profile_idx on public.paid_leave_ledger (profile_id, entry_month);
create index if not exists paid_leave_ledger_created_by_idx on public.paid_leave_ledger (created_by);
alter table public.paid_leave_ledger enable row level security;
revoke all on public.paid_leave_ledger from anon, authenticated;
grant select on public.paid_leave_ledger to authenticated;
drop policy if exists paid_leave_ledger_select on public.paid_leave_ledger;
create policy paid_leave_ledger_select on public.paid_leave_ledger for select to authenticated
  using (profile_id = (select private.my_id()) or private.is_hr_staff());

-- append-only: an entry is never changed or removed (a mistake is corrected by another entry). Only the database's own foreign-key actions
-- pass (the removal of the employee's profile takes their entries with it; a removed leave request leaves its entry, unlinked).
create or replace function private.tg_paid_leave_ledger_append_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'FORBIDDEN: Paid leave entries are never changed or removed. Add a correction instead.' using errcode = '42501';
end $$;
revoke all on function private.tg_paid_leave_ledger_append_only() from public, anon, authenticated;
drop trigger if exists paid_leave_ledger_append_only on public.paid_leave_ledger;
create trigger paid_leave_ledger_append_only before update or delete on public.paid_leave_ledger
  for each row execute function private.tg_paid_leave_ledger_append_only();

-- ---------------------------------------------------------------------------
-- 2. Eligibility and the monthly credit
-- ---------------------------------------------------------------------------
create or replace function private.ist_month(p_at timestamptz default now())
returns date language sql stable as $$ select date_trunc('month', (p_at at time zone 'Asia/Kolkata'))::date $$;
revoke all on function private.ist_month(timestamptz) from public, anon, authenticated;

-- the days of a leave request: half a day, or every day but Sunday (the rule of the existing leave totals)
create or replace function private.leave_request_days(r public.leave_requests)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when r.leave_type = 'HALF_DAY' then 0.5::numeric else
    (select count(*) from generate_series(r.start_date, r.end_date, interval '1 day') d where extract(isodow from d) <> 7)::numeric end
$$;
revoke all on function private.leave_request_days(public.leave_requests) from public, anon, authenticated;

-- where the employee stands: the latest probation cycle of their profile
create or replace function private.employment_status_of(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'status', case c.status when 'APPROVED' then 'FULL_TIME'
                              when 'DISMISSED' then 'NOT_CONFIRMED'
                              else case when private.hr_today() > c.probation_end then 'CONFIRMATION_PENDING' else 'PROBATION' end end,
      'joiningDate', c.joining_date, 'probationEnd', c.probation_end, 'confirmedFrom', case when c.status = 'APPROVED' then c.effective_date end,
      'cycleId', c.id)
      from public.hr_probation_cycles c where c.profile_id = p_profile
     order by (c.status = 'APPROVED') desc, c.joining_date desc, c.created_at desc limit 1),
    jsonb_build_object('status', 'UNKNOWN'))
$$;
revoke all on function private.employment_status_of(uuid) from public, anon, authenticated;

-- the first month the employee earns paid leave, or null (not confirmed, inactive, or the policy is switched off)
create or replace function private.paid_leave_first_month(p_profile uuid)
returns date language sql stable security definer set search_path = '' as $$
  with s as (select * from public.paid_leave_settings where id),
       c as (select pc.effective_date from public.hr_probation_cycles pc
              where pc.profile_id = p_profile and pc.status = 'APPROVED' and pc.effective_date is not null
              order by pc.approved_at desc nulls last, pc.updated_at desc limit 1)
  select greatest(
           case when s.partial_month_rule = 'EFFECTIVE_MONTH' or c.effective_date = date_trunc('month', c.effective_date)::date
                then date_trunc('month', c.effective_date)::date
                else (date_trunc('month', c.effective_date) + interval '1 month')::date end,
           coalesce(s.accrual_start_month, '-infinity'::date))
    from s, c
   where s.enabled and s.accrual_start_month is not null
     and exists (select 1 from public.profiles p where p.id = p_profile and p.status = 'ACTIVE')
$$;
revoke all on function private.paid_leave_first_month(uuid) from public, anon, authenticated;

-- credits every month that is due and not credited yet (a month is due on its credit day, IST). Idempotent: the unique key keeps one per month.
create or replace function private.paid_leave_accrue(p_profile uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.paid_leave_settings;
  v_first date := private.paid_leave_first_month(p_profile);
  v_today date := private.hr_today();
  v_last date;
  v_n integer;
begin
  if v_first is null then return 0; end if;
  select * into s from public.paid_leave_settings where id;
  v_last := date_trunc('month', v_today)::date;
  if extract(day from v_today) < s.credit_day then v_last := (v_last - interval '1 month')::date; end if;
  if v_last < v_first then return 0; end if;
  insert into public.paid_leave_ledger (profile_id, entry_type, days, entry_month, note)
  select p_profile, 'MONTHLY_CREDIT', s.monthly_days, m::date, 'Monthly paid leave'
    from generate_series(v_first, v_last, interval '1 month') m
  on conflict (profile_id, entry_month) where entry_type = 'MONTHLY_CREDIT' do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.paid_leave_accrue(uuid) from public, anon, authenticated;

create or replace function private.paid_leave_accrue_all()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_total integer := 0;
begin
  if not coalesce((select enabled from public.paid_leave_settings where id), false) then return 0; end if;
  for r in select distinct pc.profile_id from public.hr_probation_cycles pc join public.profiles p on p.id = pc.profile_id
            where pc.status = 'APPROVED' and p.status = 'ACTIVE' loop
    v_total := v_total + private.paid_leave_accrue(r.profile_id);
  end loop;
  return v_total;
end $$;
revoke all on function private.paid_leave_accrue_all() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('paid-leave-accrual', '7 19 * * *', 'select private.paid_leave_accrue_all()');   -- 00:37 IST, daily (does nothing while off)
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The balance (always the ledger, never the browser)
-- ---------------------------------------------------------------------------
create or replace function private.paid_leave_balance_json(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with l as (select * from public.paid_leave_ledger where profile_id = p_profile),
       m as (select private.ist_month() as month),
       pend as (select coalesce(sum(private.leave_request_days(r)), 0) as days, count(*) as n
                  from public.leave_requests r
                 where r.employee_id = p_profile and r.paid
                   and r.status in ('PENDING_TEAM_LEAD', 'PENDING_DEPARTMENT_HEAD', 'PENDING_OPERATIONS_HEAD', 'PENDING_HR', 'PENDING_SUPER_ADMIN', 'REVISION_REQUIRED')),
       allpend as (select count(*) as n from public.leave_requests r
                    where r.employee_id = p_profile and r.status like 'PENDING%' or (r.employee_id = p_profile and r.status = 'REVISION_REQUIRED'))
  select jsonb_build_object(
    'employment', private.employment_status_of(p_profile),
    'policy', (select jsonb_build_object('enabled', s.enabled, 'monthlyDays', s.monthly_days, 'creditDay', s.credit_day,
                                         'partialMonthRule', s.partial_month_rule, 'accrualStartMonth', s.accrual_start_month)
                 from public.paid_leave_settings s where s.id),
    'eligibleFrom', private.paid_leave_first_month(p_profile),
    'month', (select month from m),
    'carriedForward', coalesce((select sum(days) from l, m where l.entry_month < m.month), 0),
    'creditedThisMonth', coalesce((select sum(days) from l, m where l.entry_month = m.month and l.entry_type = 'MONTHLY_CREDIT'), 0),
    'usedThisMonth', coalesce((select -sum(days) from l, m where l.entry_month = m.month and l.entry_type in ('LEAVE_DEBIT', 'LEAVE_REVERSAL')), 0),
    'adjustedThisMonth', coalesce((select sum(days) from l, m where l.entry_month = m.month and l.entry_type in ('CORRECTION', 'OPENING_BALANCE')), 0),
    'totalCredited', coalesce((select sum(days) from l where entry_type in ('MONTHLY_CREDIT', 'OPENING_BALANCE')), 0),
    'totalUsed', coalesce((select -sum(days) from l where entry_type in ('LEAVE_DEBIT', 'LEAVE_REVERSAL')), 0),
    'balance', coalesce((select sum(days) from l), 0),
    'pendingPaidDays', (select days from pend),
    'pendingPaidRequests', (select n from pend),
    'pendingRequests', (select n from allpend),
    'available', coalesce((select sum(days) from l), 0) - (select days from pend))
$$;
revoke all on function private.paid_leave_balance_json(uuid) from public, anon, authenticated;

-- the employee's own balance (credits due are added first, so the figure is current)
create or replace function public.my_paid_leave_balance()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
begin
  if me is null then raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501'; end if;
  perform private.paid_leave_accrue(me);
  return private.paid_leave_balance_json(me);
end $$;
revoke all on function public.my_paid_leave_balance() from public, anon;
grant execute on function public.my_paid_leave_balance() to authenticated;

-- one employee's balance and entries, for HR and the Super Admin
create or replace function public.hr_paid_leave_detail(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() and p_profile is distinct from private.my_id() then
    raise exception 'FORBIDDEN: Paid leave balances are for HR.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001'; end if;
  perform private.paid_leave_accrue(p_profile);
  return private.paid_leave_balance_json(p_profile) || jsonb_build_object(
    'profileId', p_profile, 'fullName', (select full_name from public.profiles where id = p_profile),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('type', l.entry_type, 'days', l.days, 'month', l.entry_month, 'note', l.note,
                                                             'leaveRequestId', l.leave_request_id, 'at', l.created_at,
                                                             'by', (select full_name from public.profiles p where p.id = l.created_by)) order by l.created_at desc, l.id desc)
                           from public.paid_leave_ledger l where l.profile_id = p_profile), '[]'::jsonb));
end $$;
revoke all on function public.hr_paid_leave_detail(uuid) from public, anon;
grant execute on function public.hr_paid_leave_detail(uuid) to authenticated;

-- every employee with a probation record, their status and balance (HR / Super Admin)
create or replace function public.hr_paid_leave_balances(p_search text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
begin
  if not private.is_hr_staff() then raise exception 'FORBIDDEN: Paid leave balances are for HR.' using errcode = '42501'; end if;
  perform private.paid_leave_accrue_all();
  return jsonb_build_object(
    'policy', (select jsonb_build_object('enabled', s.enabled, 'monthlyDays', s.monthly_days, 'creditDay', s.credit_day,
                                         'partialMonthRule', s.partial_month_rule, 'accrualStartMonth', s.accrual_start_month, 'updatedAt', s.updated_at)
                 from public.paid_leave_settings s where s.id),
    'canChangePolicy', private.is_hr_leadership(),
    'items', coalesce((
      select jsonb_agg(private.paid_leave_balance_json(p.id) || jsonb_build_object('profileId', p.id, 'fullName', p.full_name,
                         'department', (select d.name from public.departments d where d.id = p.department_id)) order by p.full_name)
        from public.profiles p
       where p.status = 'ACTIVE' and exists (select 1 from public.hr_probation_cycles c where c.profile_id = p.id)
         and (v_q = '' or position(v_q in lower(p.full_name || ' ' || coalesce(p.email, ''))) > 0)), '[]'::jsonb));
end $$;
revoke all on function public.hr_paid_leave_balances(text) from public, anon;
grant execute on function public.hr_paid_leave_balances(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Paid leave requests: reserve on submit, deduct once on final approval
-- ---------------------------------------------------------------------------
-- The existing request (every rule, the approval chain and its notifications unchanged), marked paid after the balance is checked.
-- The employee's balance is locked for the check, so two requests at once cannot overbook it.
create or replace function public.submit_paid_leave_request(p_leave_type text, p_start date, p_end date, p_half_day_shift text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_row jsonb;
  r public.leave_requests;
  b jsonb;
  v_days numeric;
begin
  if me is null then raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('paid_leave:' || me::text, 0));
  if private.paid_leave_first_month(me) is null and not exists (select 1 from public.paid_leave_ledger where profile_id = me) then
    raise exception 'VALIDATION_ERROR: Paid leave starts after your confirmation as a full-time employee. You can apply for unpaid leave.' using errcode = 'P0001';
  end if;
  perform private.paid_leave_accrue(me);
  v_row := public.submit_leave_request(p_leave_type, p_start, p_end, p_half_day_shift, p_reason);
  select * into r from public.leave_requests where id = (v_row ->> 'id')::uuid for update;
  v_days := private.leave_request_days(r);
  b := private.paid_leave_balance_json(me);   -- the new request is not paid yet, so it is not in the pending sum
  if v_days > (b ->> 'available')::numeric then
    raise exception 'VALIDATION_ERROR: You have % paid leave day(s) available (% waiting for approval). Choose fewer days or apply for unpaid leave.',
      (b ->> 'available'), (b ->> 'pendingPaidDays') using errcode = 'P0001';
  end if;
  update public.leave_requests set paid = true where id = r.id returning * into r;
  perform private.write_audit('PAID_LEAVE_REQUESTED', 'leave_request', r.id, r.department_id, null, jsonb_build_object('days', v_days, 'availableBefore', b ->> 'available'));
  return private.leave_row(r);
end $$;
revoke all on function public.submit_paid_leave_request(text, date, date, text, text) from public, anon;
grant execute on function public.submit_paid_leave_request(text, date, date, text, text) to authenticated;

-- final approval deducts once (any approval path: the multi-level chain or the earlier two-step flow). Rejected requests never consumed anything.
create or replace function private.tg_leave_requests_paid_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_days numeric := private.leave_request_days(new);
begin
  if tg_op = 'UPDATE' and old.paid and not new.paid and exists (select 1 from public.paid_leave_ledger where leave_request_id = old.id) then
    raise exception 'CONFLICT: A paid leave that was deducted cannot be turned into unpaid leave.' using errcode = 'P0001';
  end if;
  if not new.paid then return new; end if;
  if new.status = 'APPROVED' and (tg_op = 'INSERT' or old.status is distinct from 'APPROVED') then
    insert into public.paid_leave_ledger (profile_id, entry_type, days, entry_month, leave_request_id, note, created_by)
    values (new.employee_id, 'LEAVE_DEBIT', -v_days, private.ist_month(), new.id,
            format('Paid leave %s to %s', to_char(new.start_date, 'DD Mon YYYY'), to_char(new.end_date, 'DD Mon YYYY')), private.my_id())
    on conflict (leave_request_id) where entry_type = 'LEAVE_DEBIT' do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'APPROVED' and new.status <> 'APPROVED'
        and exists (select 1 from public.paid_leave_ledger where leave_request_id = new.id and entry_type = 'LEAVE_DEBIT') then
    -- no workflow takes an approved leave back today; if one is added it must give the days back through an HR correction (audited),
    -- so a deducted request never silently changes state
    raise exception 'CONFLICT: This paid leave is approved and deducted. HR gives the days back with a correction.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_leave_requests_paid_ledger() from public, anon, authenticated;
drop trigger if exists leave_requests_paid_ledger on public.leave_requests;
create trigger leave_requests_paid_ledger after insert or update of status, paid on public.leave_requests
  for each row execute function private.tg_leave_requests_paid_ledger();

-- the leave row shows whether it is paid (the shape of every leave the API returns; everything else as in 20261228000200)
do $$
declare
  v_src text;
begin
  select pg_get_functiondef('private.leave_row(public.leave_requests)'::regprocedure) into v_src;
  if position('''paid''' in v_src) = 0 then
    v_src := replace(v_src, '''leaveType'', r.leave_type,', '''leaveType'', r.leave_type, ''paid'', r.paid,');
    if position('''paid''' in v_src) = 0 then
      raise exception 'leave_row has changed shape; add the paid flag by hand';
    end if;
    execute v_src;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. HR: opening balances, corrections, the confirmation date, the policy (all audited)
-- ---------------------------------------------------------------------------
create or replace function public.hr_paid_leave_adjust(p_profile uuid, p_kind text, p_days numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_kind text := upper(coalesce(p_kind, ''));
  p public.profiles;
begin
  if not private.is_hr_staff() then raise exception 'FORBIDDEN: Only HR corrects paid leave.' using errcode = '42501'; end if;
  if p_profile = private.my_id() and not private.is_super_admin() then
    raise exception 'FORBIDDEN: Nobody corrects their own paid leave.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = p_profile;
  if p.id is null then raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001'; end if;
  if v_kind not in ('OPENING_BALANCE', 'CORRECTION') then raise exception 'VALIDATION_ERROR: Choose an opening balance or a correction.' using errcode = 'P0001'; end if;
  if p_days is null or p_days = 0 or abs(p_days) > 400 or p_days * 2 <> round(p_days * 2) then
    raise exception 'VALIDATION_ERROR: Enter the days in whole or half days (not zero).' using errcode = 'P0001';
  end if;
  if v_kind = 'OPENING_BALANCE' and p_days < 0 then raise exception 'VALIDATION_ERROR: An opening balance cannot be negative.' using errcode = 'P0001'; end if;
  if v_note is null or length(v_note) < 5 then raise exception 'VALIDATION_ERROR: Give the reason (it is kept with the entry).' using errcode = 'P0001'; end if;
  if v_kind = 'OPENING_BALANCE' and exists (select 1 from public.paid_leave_ledger where profile_id = p_profile and entry_type = 'OPENING_BALANCE') then
    raise exception 'CONFLICT: This employee already has an opening balance. Add a correction instead.' using errcode = 'P0001';
  end if;
  insert into public.paid_leave_ledger (profile_id, entry_type, days, entry_month, note, created_by)
  values (p_profile, v_kind, p_days, private.ist_month(), v_note, private.my_id());
  perform private.write_audit('PAID_LEAVE_' || v_kind, 'profile', p_profile, p.department_id, p.team_id, jsonb_build_object('days', p_days, 'note', v_note));
  perform private.notify(p_profile, 'PAID_LEAVE_ADJUSTED', 'Your paid leave balance was updated', format('%s day(s): %s', p_days, v_note), 'profile', p_profile);
  return public.hr_paid_leave_detail(p_profile);
end $$;
revoke all on function public.hr_paid_leave_adjust(uuid, text, numeric, text) from public, anon;
grant execute on function public.hr_paid_leave_adjust(uuid, text, numeric, text) to authenticated;

-- An approved confirmation's effective date corrected by the people who may confirm it. Future credits follow the new date; credits already
-- given stay as they are (HR adds a correction if they must change), so no past leave record changes silently.
create or replace function public.hr_confirmation_effective_date_set(p_cycle uuid, p_effective date, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  v_before date;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the employee''s Department Head or the Super Admin can change a confirmation.' using errcode = '42501';
  end if;
  if c.status <> 'APPROVED' then raise exception 'CONFLICT: Only an approved confirmation has an effective date to correct.' using errcode = 'P0001'; end if;
  if p_effective is null or p_effective < c.joining_date or p_effective > private.hr_today() + 366 then
    raise exception 'VALIDATION_ERROR: Enter a valid confirmation effective date.' using errcode = 'P0001';
  end if;
  if v_note is null or length(v_note) < 5 then raise exception 'VALIDATION_ERROR: Give the reason for the change.' using errcode = 'P0001'; end if;
  v_before := c.effective_date;
  update public.hr_probation_cycles set effective_date = p_effective, updated_at = now() where id = c.id returning * into c;
  perform private.write_audit('EMPLOYEE_CONFIRMATION_DATE_CHANGED', 'hr_probation', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'before', v_before, 'after', p_effective, 'note', v_note));
  return jsonb_build_object('cycleId', c.id, 'effectiveDate', c.effective_date, 'before', v_before);
end $$;
revoke all on function public.hr_confirmation_effective_date_set(uuid, date, text) from public, anon;
grant execute on function public.hr_confirmation_effective_date_set(uuid, date, text) to authenticated;

create or replace function public.paid_leave_settings_set(p_enabled boolean, p_monthly_days numeric, p_credit_day integer, p_partial_month_rule text, p_start_month date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.paid_leave_settings;
  a public.paid_leave_settings;
begin
  if not private.is_hr_leadership() then raise exception 'FORBIDDEN: Only the HR Department Head or the Super Admin sets the paid leave policy.' using errcode = '42501'; end if;
  if p_enabled is null or p_monthly_days is null or p_credit_day is null or p_partial_month_rule is null then
    raise exception 'VALIDATION_ERROR: Fill in every setting.' using errcode = 'P0001';
  end if;
  if p_monthly_days <= 0 or p_monthly_days > 10 or p_monthly_days * 2 <> round(p_monthly_days * 2) then raise exception 'VALIDATION_ERROR: Days a month: half days up to 10.' using errcode = 'P0001'; end if;
  if p_credit_day not between 1 and 28 then raise exception 'VALIDATION_ERROR: The credit day is between 1 and 28.' using errcode = 'P0001'; end if;
  if p_partial_month_rule not in ('NEXT_FULL_MONTH', 'EFFECTIVE_MONTH') then raise exception 'VALIDATION_ERROR: Unknown rule for the month of confirmation.' using errcode = 'P0001'; end if;
  if p_enabled and p_start_month is null then raise exception 'VALIDATION_ERROR: Choose the first month to credit (nothing is credited before it).' using errcode = 'P0001'; end if;
  select * into b from public.paid_leave_settings where id for update;
  update public.paid_leave_settings
     set enabled = p_enabled, monthly_days = p_monthly_days, credit_day = p_credit_day, partial_month_rule = p_partial_month_rule,
         accrual_start_month = case when p_start_month is null then accrual_start_month else date_trunc('month', p_start_month)::date end,
         updated_by = private.my_id(), updated_at = now()
   where id returning * into a;
  perform private.write_audit('PAID_LEAVE_POLICY_SET', 'settings', null, null, null, jsonb_build_object('before', to_jsonb(b) - 'id', 'after', to_jsonb(a) - 'id'));
  return jsonb_build_object('enabled', a.enabled, 'monthlyDays', a.monthly_days, 'creditDay', a.credit_day, 'partialMonthRule', a.partial_month_rule, 'accrualStartMonth', a.accrual_start_month);
end $$;
revoke all on function public.paid_leave_settings_set(boolean, numeric, integer, text, date) from public, anon;
grant execute on function public.paid_leave_settings_set(boolean, numeric, integer, text, date) to authenticated;
