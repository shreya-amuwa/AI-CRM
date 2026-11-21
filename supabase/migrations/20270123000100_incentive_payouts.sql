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

-- ---------------------------------------------------------------------------
-- 6. Withdrawal requests (the person)
-- ---------------------------------------------------------------------------
-- Tell every active member of the Accounts department.
create or replace function private.payout_notify_accounts(p_type text, p_title text, p_body text, p_entity uuid)
returns void language sql security definer set search_path = '' as $$
  select private.notify(p.id, p_type, p_title, p_body, 'payout_request', p_entity)
    from public.profiles p join public.departments d on d.id = p.department_id
   where p.status = 'ACTIVE' and d.slug = 'accounts'
$$;
revoke all on function private.payout_notify_accounts(text, text, text, uuid) from public, anon, authenticated;

create or replace function public.payout_request(p_amount numeric, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
  m public.payout_methods;
  r public.payout_requests;
  v_amount numeric := round(p_amount, 2);
  v_opens date := private.payout_opens_on(me.id);
  v_avail numeric;
begin
  if p_request_id is null or length(p_request_id) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Send the request again.' using errcode = 'P0001';
  end if;
  select * into r from public.payout_requests where request_id = p_request_id;
  if r.id is not null then
    if r.profile_id <> me.id then
      raise exception 'CONFLICT: Send the request again.' using errcode = 'P0001';
    end if;
    return private.payout_request_json(r, true);   -- the same press sent twice
  end if;
  if v_opens is null then
    raise exception 'VALIDATION_ERROR: Withdrawals open % days after HR records your joining date.',
      (select start_after_days from public.incentive_settings where id) using errcode = 'P0001';
  end if;
  if private.office_today() < v_opens then
    raise exception 'VALIDATION_ERROR: Withdrawals open on %.', to_char(v_opens, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  if v_amount is null or v_amount < 500 then
    raise exception 'VALIDATION_ERROR: Withdraw at least ₹500.' using errcode = 'P0001';
  end if;
  select * into m from public.payout_methods where profile_id = me.id;
  if m.profile_id is null then
    raise exception 'VALIDATION_ERROR: Add your payout details first.' using errcode = 'P0001';
  end if;
  -- one request at a time per person: lock this person's requests while checking
  perform 1 from public.payout_requests where profile_id = me.id for update;
  if exists (select 1 from public.payout_requests where profile_id = me.id and status in ('REQUESTED', 'PROCESSING')) then
    raise exception 'CONFLICT: You already have a withdrawal waiting. Cancel it or wait until Accounts pays it.' using errcode = 'P0001';
  end if;
  v_avail := private.payout_available(me.id);
  if v_amount > v_avail then
    raise exception 'VALIDATION_ERROR: You can withdraw up to ₹%.', greatest(v_avail, 0) using errcode = 'P0001';
  end if;
  insert into public.payout_requests (profile_id, amount, method_snapshot, request_id)
  values (me.id, v_amount, jsonb_build_object('full', private.payout_method_json(m, true), 'masked', private.payout_method_json(m, false)), p_request_id)
  returning * into r;
  perform private.write_audit('PAYOUT_REQUESTED', 'payout_request', r.id, me.department_id, me.team_id, jsonb_build_object('amount', v_amount));
  perform private.payout_notify_accounts('PAYOUT_REQUESTED', 'Withdrawal request',
    format('%s asked to withdraw ₹%s.', me.full_name, to_char(v_amount, 'FM99,99,99,990.00')), r.id);
  return private.payout_request_json(r, true);
end $$;
revoke all on function public.payout_request(numeric, text) from public, anon;
grant execute on function public.payout_request(numeric, text) to authenticated;

create or replace function public.payout_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
  r public.payout_requests;
begin
  select * into r from public.payout_requests where id = p_id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: This withdrawal does not exist.' using errcode = 'P0001';
  end if;
  if r.profile_id <> me.id then
    raise exception 'FORBIDDEN: You can only cancel your own withdrawal.' using errcode = '42501';
  end if;
  if r.status <> 'REQUESTED' then
    raise exception 'CONFLICT: This withdrawal was already handled.' using errcode = 'P0001';
  end if;
  update public.payout_requests set status = 'CANCELLED', decided_at = now(), decided_by = me.id where id = r.id returning * into r;
  perform private.write_audit('PAYOUT_CANCELLED', 'payout_request', r.id, me.department_id, me.team_id, jsonb_build_object('amount', r.amount));
  return private.payout_request_json(r, true);
end $$;
revoke all on function public.payout_cancel(uuid) from public, anon;
grant execute on function public.payout_cancel(uuid) to authenticated;

create or replace function public.payout_my_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
begin
  return coalesce((select jsonb_agg(private.payout_request_json(r, true) order by r.requested_at desc)
                     from public.payout_requests r where r.profile_id = me.id), '[]'::jsonb);
end $$;
revoke all on function public.payout_my_requests() from public, anon;
grant execute on function public.payout_my_requests() to authenticated;

-- details changed while a request is open: Accounts is told (the request keeps the details it was made with)
create or replace function private.payout_methods_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_open uuid;
begin
  select id into v_open from public.payout_requests where profile_id = new.profile_id and status in ('REQUESTED', 'PROCESSING') limit 1;
  if v_open is not null then
    perform private.payout_notify_accounts('PAYOUT_DETAILS_CHANGED', 'Payout details changed',
      format('%s changed their payout details while a withdrawal is waiting. Pay to the details shown on the request.',
             (select full_name from public.profiles where id = new.profile_id)), v_open);
  end if;
  return new;
end $$;
revoke all on function private.payout_methods_changed() from public, anon, authenticated;
drop trigger if exists payout_methods_changed on public.payout_methods;
create trigger payout_methods_changed after update on public.payout_methods for each row execute function private.payout_methods_changed();

-- ---------------------------------------------------------------------------
-- 7. Accounts: the queue, paying, rejecting, people who left
-- ---------------------------------------------------------------------------
create or replace function private.payout_accounts_actor(p_owner uuid)
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  perform private.require_accounts_staff();
  select * into me from public.profiles where id = auth.uid();
  if p_owner is not null and me.id = p_owner then
    raise exception 'FORBIDDEN: You cannot pay your own withdrawal.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.payout_accounts_actor(uuid) from public, anon, authenticated;

create or replace function public.payout_queue(p_status text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return coalesce((select jsonb_agg(private.payout_request_json(r, false) || jsonb_build_object('available', private.payout_available(r.profile_id))
                                    order by r.requested_at desc)
                     from (select * from public.payout_requests x
                            where x.status = coalesce(nullif(upper(btrim(p_status)), ''), 'REQUESTED')
                            order by x.requested_at desc limit 500) r), '[]'::jsonb);
end $$;
revoke all on function public.payout_queue(text) from public, anon;
grant execute on function public.payout_queue(text) to authenticated;

create or replace function public.payout_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return jsonb_build_object('requested', (select count(*) from public.payout_requests where status = 'REQUESTED'),
                            'processing', (select count(*) from public.payout_requests where status = 'PROCESSING'));
end $$;
revoke all on function public.payout_counts() from public, anon;
grant execute on function public.payout_counts() to authenticated;

create or replace function public.payout_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.payout_requests;
begin
  perform private.require_accounts_staff();
  select * into r from public.payout_requests where id = p_id;
  if r.id is null then
    raise exception 'NOT_FOUND: This withdrawal does not exist.' using errcode = 'P0001';
  end if;
  return private.payout_request_json(r, true) || jsonb_build_object(
    'available', private.payout_available(r.profile_id),
    'withdrawn', private.payout_withdrawn(r.profile_id),
    'personActive', (select status = 'ACTIVE' from public.profiles where id = r.profile_id),
    'recentEarnings', coalesce((select jsonb_agg(jsonb_build_object('earnedAt', e.earned_at, 'eventType', e.event_type, 'role', e.role, 'amount', e.amount,
                                   'status', e.status, 'ruleName', ru.name) order by e.earned_at desc)
                                  from (select * from public.earnings where profile_id = r.profile_id order by earned_at desc limit 20) e
                                  join public.incentive_rules ru on ru.id = e.rule_id), '[]'::jsonb));
end $$;
revoke all on function public.payout_detail(uuid) from public, anon;
grant execute on function public.payout_detail(uuid) to authenticated;

-- Paying: PAID, net = gross - TDS, a "Sales Incentive" expense of the person's department (company-wide without one), audit, notify.
create or replace function private.payout_settle(r public.payout_requests, p_reference text, p_paid_on date, p_tds numeric, p_channel text, p_actor uuid)
returns public.payout_requests language plpgsql security definer set search_path = '' as $$
declare
  owner_p public.profiles;
  v_ref text := nullif(btrim(p_reference), '');
  v_tds numeric := round(coalesce(p_tds, 0), 2);
  v_exp uuid;
begin
  if v_ref is null or length(v_ref) > 120 then
    raise exception 'VALIDATION_ERROR: Enter the bank or UPI reference of the payment.' using errcode = 'P0001';
  end if;
  if p_paid_on is null or p_paid_on > private.office_today() then
    raise exception 'VALIDATION_ERROR: Enter the date the money was sent (not in the future).' using errcode = 'P0001';
  end if;
  if v_tds < 0 or v_tds >= r.amount then
    raise exception 'VALIDATION_ERROR: TDS must be at least 0 and less than the amount.' using errcode = 'P0001';
  end if;
  select * into owner_p from public.profiles where id = r.profile_id;
  insert into public.department_expenses (expense_date, description, department_id, category, amount, payment_status, notes, source, created_by)
  values (p_paid_on, left('Sales incentive payout - ' || owner_p.full_name, 300), owner_p.department_id, 'Sales Incentive', r.amount, 'PAID',
          left(format('Withdrawal %s, reference %s, TDS %s', r.id, v_ref, v_tds), 1000), 'MANUAL', p_actor)
  returning id into v_exp;
  -- the department's allocation (the expenses trigger adds it when the expense has a department; this makes sure it exists)
  if owner_p.department_id is not null then
    insert into public.expense_allocations (expense_id, department_id, amount) values (v_exp, owner_p.department_id, r.amount)
    on conflict (expense_id, department_id) do nothing;
  end if;
  update public.payout_requests
     set status = 'PAID', channel = p_channel, reference = v_ref, paid_on = p_paid_on, tds_amount = v_tds, net_amount = r.amount - v_tds,
         decided_by = coalesce(decided_by, p_actor), decided_at = now(), expense_id = v_exp
   where id = r.id returning * into r;
  perform private.write_audit('PAYOUT_PAID', 'payout_request', r.id, owner_p.department_id, owner_p.team_id,
    jsonb_build_object('amount', r.amount, 'tds', v_tds, 'net', r.net_amount, 'reference', v_ref, 'channel', p_channel, 'finalSettlement', r.final_settlement));
  perform private.notify(r.profile_id, 'PAYOUT_PAID', 'Your withdrawal was paid',
    format('₹%s was sent to you (reference %s).', to_char(r.net_amount, 'FM99,99,99,990.00'), v_ref), 'payout_request', r.id);
  return r;
end $$;
revoke all on function private.payout_settle(public.payout_requests, text, date, numeric, text, uuid) from public, anon, authenticated;

create or replace function public.payout_mark_paid(p_id uuid, p_reference text, p_paid_on date, p_tds numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.payout_requests;
  me public.profiles;
begin
  perform private.require_accounts_staff();
  select * into r from public.payout_requests where id = p_id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: This withdrawal does not exist.' using errcode = 'P0001';
  end if;
  me := private.payout_accounts_actor(r.profile_id);
  if r.status <> 'REQUESTED' then
    raise exception 'CONFLICT: This withdrawal was already handled.' using errcode = 'P0001';
  end if;
  r := private.payout_settle(r, p_reference, p_paid_on, p_tds, 'MANUAL', me.id);
  return private.payout_request_json(r, true);
end $$;
revoke all on function public.payout_mark_paid(uuid, text, date, numeric) from public, anon;
grant execute on function public.payout_mark_paid(uuid, text, date, numeric) to authenticated;

create or replace function public.payout_reject(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.payout_requests;
  me public.profiles;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform private.require_accounts_staff();
  select * into r from public.payout_requests where id = p_id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: This withdrawal does not exist.' using errcode = 'P0001';
  end if;
  me := private.payout_accounts_actor(r.profile_id);
  if r.status <> 'REQUESTED' then
    raise exception 'CONFLICT: This withdrawal was already handled.' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'VALIDATION_ERROR: Say why the withdrawal is rejected.' using errcode = 'P0001';
  end if;
  update public.payout_requests set status = 'REJECTED', reason = v_reason, decided_by = me.id, decided_at = now() where id = r.id returning * into r;
  perform private.write_audit('PAYOUT_REJECTED', 'payout_request', r.id, null, null, jsonb_build_object('amount', r.amount, 'reason', v_reason));
  perform private.notify(r.profile_id, 'PAYOUT_REJECTED', 'Your withdrawal was rejected', v_reason, 'payout_request', r.id);
  return private.payout_request_json(r, true);
end $$;
revoke all on function public.payout_reject(uuid, text) from public, anon;
grant execute on function public.payout_reject(uuid, text) to authenticated;

-- People who left with money still to come.
create or replace function public.payout_leavers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.full_name, 'department', d.name, 'status', p.status,
                                      'available', private.payout_available(p.id),
                                      'method', (select private.payout_method_json(m, true) from public.payout_methods m where m.profile_id = p.id))
                                    order by p.full_name)
                     from public.profiles p left join public.departments d on d.id = p.department_id
                    where p.status <> 'ACTIVE' and private.payout_available(p.id) > 0
                      and not exists (select 1 from public.payout_requests x where x.profile_id = p.id and x.status in ('REQUESTED', 'PROCESSING'))), '[]'::jsonb);
end $$;
revoke all on function public.payout_leavers() from public, anon;
grant execute on function public.payout_leavers() to authenticated;

create or replace function public.payout_final_settlement(p_profile uuid, p_reference text, p_paid_on date, p_tds numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_accounts_actor(p_profile);
  owner_p public.profiles;
  m public.payout_methods;
  r public.payout_requests;
  v_avail numeric;
begin
  select * into owner_p from public.profiles where id = p_profile for update;
  if owner_p.id is null then
    raise exception 'NOT_FOUND: This person does not exist.' using errcode = 'P0001';
  end if;
  if owner_p.status = 'ACTIVE' then
    raise exception 'VALIDATION_ERROR: A final settlement is only for people who have left. Active staff ask for a withdrawal themselves.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payout_requests where profile_id = p_profile and status in ('REQUESTED', 'PROCESSING')) then
    raise exception 'CONFLICT: This person has a withdrawal waiting: pay or reject it first.' using errcode = 'P0001';
  end if;
  v_avail := private.payout_available(p_profile);
  if v_avail <= 0 then
    raise exception 'VALIDATION_ERROR: Nothing is left to pay this person.' using errcode = 'P0001';
  end if;
  select * into m from public.payout_methods where profile_id = p_profile;
  insert into public.payout_requests (profile_id, amount, method_snapshot, final_settlement, decided_by)
  values (p_profile, v_avail, jsonb_build_object('full', private.payout_method_json(m, true), 'masked', private.payout_method_json(m, false)), true, me.id)
  returning * into r;
  r := private.payout_settle(r, p_reference, p_paid_on, p_tds, 'MANUAL', me.id);
  return private.payout_request_json(r, true);
end $$;
revoke all on function public.payout_final_settlement(uuid, text, date, numeric) from public, anon;
grant execute on function public.payout_final_settlement(uuid, text, date, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The payout slip: the values printed on it (the server draws the PDF on each download; values never change once paid)
-- ---------------------------------------------------------------------------
create or replace function public.payout_slip_data(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.payout_requests;
  p public.profiles;
begin
  select * into r from public.payout_requests where id = p_id;
  if r.id is null then
    raise exception 'NOT_FOUND: This withdrawal does not exist.' using errcode = 'P0001';
  end if;
  if r.profile_id is distinct from auth.uid() and not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the person paid and Accounts can download this slip.' using errcode = '42501';
  end if;
  if r.status not in ('PAID', 'REVERSED') then
    raise exception 'CONFLICT: A slip is available once the withdrawal is paid.' using errcode = 'P0001';
  end if;
  select * into p from public.profiles where id = r.profile_id;
  perform private.write_audit('PAYOUT_SLIP_DOWNLOADED', 'payout_request', r.id, p.department_id, p.team_id, '{}'::jsonb);
  return jsonb_build_object(
    'slipNo', 'PO-' || to_char(coalesce(r.paid_on, r.decided_at::date), 'YYMM') || '-' || upper(left(replace(r.id::text, '-', ''), 6)),
    'name', p.full_name, 'employeeCode', (select h.id from public.hr_employees h where h.profile_id = p.id),
    'department', (select d.name from public.departments d where d.id = p.department_id),
    'amount', r.amount, 'tdsAmount', r.tds_amount, 'netAmount', r.net_amount, 'reference', r.reference, 'paidOn', r.paid_on,
    'channel', r.channel, 'method', r.method_snapshot -> 'masked', 'finalSettlement', r.final_settlement, 'void', r.status = 'REVERSED');
end $$;
revoke all on function public.payout_slip_data(uuid) from public, anon;
grant execute on function public.payout_slip_data(uuid) to authenticated;
