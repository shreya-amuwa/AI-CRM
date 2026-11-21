-- =============================================================================
-- Incentive payouts, phase 2 (design: docs/superpowers/specs/2026-11-21-incentive-payouts-design.md; follows 20270119000100 and
-- 20270121000100). Sales staff withdraw their incentive balance; Accounts pays each request by hand (Razorpay comes in a later migration).
--
-- * payout_methods: each person's payout details (bank account, UPI ID, or international details), seen in full only by the person and
--   Accounts; everyone else sees the last four characters.
-- * payout_requests: one row per withdrawal. Available = earned - paid - the open request. An earning reversed after a payout can take it
--   below zero: it is recovered from future earnings (a new request needs a positive available balance).
-- * Withdrawals open on the HR joining date + incentive_settings.start_after_days (15); without an HR joining date they stay closed.
-- * Accounts (the Accounts department or the Super Admin) marks a request paid (bank reference, date, TDS) or rejects it; nobody decides
--   their own. A paid payout is also a "Sales Incentive" expense of the person's department. People who have left are settled by Accounts.
-- Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.payout_methods (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('BANK', 'UPI', 'OTHER')),
  holder_name text not null check (length(btrim(holder_name)) between 2 and 120),
  account_number text check (account_number ~ '^[0-9]{9,18}$'),
  ifsc text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  upi_id text check (length(upi_id) <= 100),
  other_details text check (length(other_details) <= 1000),
  pan text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.payout_methods enable row level security;
revoke all on public.payout_methods from public, anon, authenticated;

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED', 'FAILED', 'REVERSED')),
  method_snapshot jsonb not null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  channel text check (channel in ('MANUAL', 'RAZORPAY')),
  reference text check (length(reference) <= 120),
  paid_on date,
  tds_amount numeric(14, 2) not null default 0 check (tds_amount >= 0),
  net_amount numeric(14, 2),
  reason text check (length(reason) <= 500),
  expense_id uuid references public.department_expenses (id) on delete set null,
  final_settlement boolean not null default false,
  request_id text unique check (length(request_id) between 8 and 80)
);
create unique index if not exists payout_requests_one_open on public.payout_requests (profile_id) where status in ('REQUESTED', 'PROCESSING');
create index if not exists payout_requests_status_idx on public.payout_requests (status, requested_at desc);
create index if not exists payout_requests_person_idx on public.payout_requests (profile_id, requested_at desc);
alter table public.payout_requests enable row level security;
revoke all on public.payout_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The day withdrawals open: the HR joining date (the HR directory, else the personal details) + the incentive start period; null when HR
-- has not recorded a joining date.
create or replace function private.payout_opens_on(p uuid)
returns date language sql stable security definer set search_path = '' as $$
  select coalesce((select private.hr_safe_date(h.joining_date) from public.hr_employees h where h.profile_id = p),
                  (select d.joining_date from public.employee_personal_details d where d.profile_id = p))
         + (select start_after_days from public.incentive_settings where id)
$$;
revoke all on function private.payout_opens_on(uuid) from public, anon, authenticated;

create or replace function private.payout_withdrawn(p uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.payout_requests where profile_id = p and status = 'PAID'
$$;
revoke all on function private.payout_withdrawn(uuid) from public, anon, authenticated;

-- earned - paid out - the open request (may be negative after a clawback)
create or replace function private.payout_available(p uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount) from public.earnings where profile_id = p and status = 'EARNED'), 0)
       - coalesce((select sum(amount) from public.payout_requests where profile_id = p and status in ('PAID', 'REQUESTED', 'PROCESSING')), 0)
$$;
revoke all on function private.payout_available(uuid) from public, anon, authenticated;

create or replace function private.payout_mask(v text)
returns text language sql immutable set search_path = '' as $$
  select case when v is null or v = '' then v else '••••' || right(v, 4) end
$$;
revoke all on function private.payout_mask(text) from public, anon, authenticated;

create or replace function private.payout_method_json(m public.payout_methods, p_full boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when m.profile_id is null then null else jsonb_build_object(
    'kind', m.kind, 'holderName', m.holder_name,
    'accountNumber', case when p_full then m.account_number else private.payout_mask(m.account_number) end,
    'ifsc', m.ifsc,
    'upiId', case when p_full then m.upi_id else private.payout_mask(m.upi_id) end,
    'otherDetails', case when p_full then m.other_details when m.other_details is null then null else 'International details on file' end,
    'pan', case when p_full then m.pan else private.payout_mask(m.pan) end,
    'updatedAt', m.updated_at) end
$$;
revoke all on function private.payout_method_json(public.payout_methods, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The person's payout details
-- ---------------------------------------------------------------------------
create or replace function private.payout_me()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.payout_me() from public, anon, authenticated;

create or replace function public.payout_method_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
begin
  return (select private.payout_method_json(m, true) from public.payout_methods m where m.profile_id = me.id);
end $$;
revoke all on function public.payout_method_get() from public, anon;
grant execute on function public.payout_method_get() to authenticated;

create or replace function public.payout_method_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
  v_kind text := upper(nullif(btrim(p ->> 'kind'), ''));
  v_name text := nullif(btrim(p ->> 'holderName'), '');
  v_acc text := nullif(regexp_replace(coalesce(p ->> 'accountNumber', ''), '\s', '', 'g'), '');
  v_ifsc text := upper(nullif(btrim(p ->> 'ifsc'), ''));
  v_upi text := nullif(btrim(p ->> 'upiId'), '');
  v_other text := nullif(btrim(p ->> 'otherDetails'), '');
  v_pan text := upper(nullif(btrim(p ->> 'pan'), ''));
  old public.payout_methods;
  m public.payout_methods;
begin
  if v_kind is null or v_kind not in ('BANK', 'UPI', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose a bank account, a UPI ID or international details.' using errcode = 'P0001';
  end if;
  if v_name is null or length(v_name) not between 2 and 120 then
    raise exception 'VALIDATION_ERROR: Enter the account holder''s name.' using errcode = 'P0001';
  end if;
  if v_kind = 'BANK' and (v_acc is null or v_acc !~ '^[0-9]{9,18}$') then
    raise exception 'VALIDATION_ERROR: Enter the account number (9 to 18 digits).' using errcode = 'P0001';
  end if;
  if v_kind = 'BANK' and (v_ifsc is null or v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$') then
    raise exception 'VALIDATION_ERROR: Enter the IFSC (11 characters, for example HDFC0001234).' using errcode = 'P0001';
  end if;
  if v_kind = 'UPI' and (v_upi is null or v_upi !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$' or length(v_upi) > 100) then
    raise exception 'VALIDATION_ERROR: Enter the UPI ID (for example name@okhdfcbank).' using errcode = 'P0001';
  end if;
  if v_kind = 'OTHER' and (v_other is null or length(v_other) > 1000) then
    raise exception 'VALIDATION_ERROR: Enter the bank name, account or IBAN, SWIFT code and country.' using errcode = 'P0001';
  end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'VALIDATION_ERROR: Enter the PAN (10 characters, for example ABCDE1234F) or leave it empty.' using errcode = 'P0001';
  end if;
  select * into old from public.payout_methods where profile_id = me.id;
  insert into public.payout_methods (profile_id, kind, holder_name, account_number, ifsc, upi_id, other_details, pan, updated_at, updated_by)
  values (me.id, v_kind, v_name, case when v_kind = 'BANK' then v_acc end, case when v_kind = 'BANK' then v_ifsc end,
          case when v_kind = 'UPI' then v_upi end, case when v_kind = 'OTHER' then v_other end, v_pan, now(), me.id)
  on conflict (profile_id) do update set kind = excluded.kind, holder_name = excluded.holder_name, account_number = excluded.account_number,
    ifsc = excluded.ifsc, upi_id = excluded.upi_id, other_details = excluded.other_details, pan = excluded.pan, updated_at = now(), updated_by = me.id
  returning * into m;
  perform private.write_audit('PAYOUT_METHOD_SAVED', 'profile', me.id, me.department_id, me.team_id,
    jsonb_build_object('before', private.payout_method_json(old, false), 'after', private.payout_method_json(m, false)));
  return private.payout_method_json(m, true);
end $$;
revoke all on function public.payout_method_save(jsonb) from public, anon;
grant execute on function public.payout_method_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A request as JSON (the method shown is the snapshot taken when it was made)
-- ---------------------------------------------------------------------------
create or replace function private.payout_request_json(r public.payout_requests, p_full boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'profileId', r.profile_id, 'name', p.full_name, 'department', d.name, 'amount', r.amount, 'status', r.status,
    'requestedAt', r.requested_at, 'decidedAt', r.decided_at, 'decidedBy', (select x.full_name from public.profiles x where x.id = r.decided_by),
    'channel', r.channel, 'reference', r.reference, 'paidOn', r.paid_on, 'tdsAmount', r.tds_amount, 'netAmount', r.net_amount,
    'reason', r.reason, 'finalSettlement', r.final_settlement,
    'method', case when p_full then r.method_snapshot -> 'full' else r.method_snapshot -> 'masked' end) end
  from (select 1) one
  left join public.profiles p on p.id = r.profile_id
  left join public.departments d on d.id = p.department_id
$$;
revoke all on function private.payout_request_json(public.payout_requests, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. My Income gains the payout figures
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
