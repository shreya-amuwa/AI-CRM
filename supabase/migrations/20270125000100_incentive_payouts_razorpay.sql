-- =============================================================================
-- Incentive payouts through RazorpayX (follows 20270123000100_incentive_payouts.sql; design: docs/superpowers/specs/2026-11-21-incentive-
-- payouts-design.md). Accounts can send a withdrawal with one click: the API asks RazorpayX to pay it, and RazorpayX's webhook (or a status
-- check) settles it. These functions are for the server only (service role); the API checks the Accountant's session first and passes them.
--
-- * begin: REQUESTED -> PROCESSING (RAZORPAY), with the TDS and net; only Accounts, never their own request, never international details.
-- * link / set id: the Razorpay contact and fund account (kept for next time, dropped when the details change) and the payout id.
-- * settle: processed -> PAID (the UTR is the reference; expense, notice as for a manual payment); failed / rejected / cancelled -> FAILED
--   (the amount is free again); reversed after it was paid -> REVERSED (its expense is removed, kept in the audit; the slip reads VOID).
--   An event already seen changes nothing.
-- * undo: Razorpay refused before a payout existed -> back to REQUESTED.
-- Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

alter table public.payout_methods add column if not exists rzp_contact_id text;
alter table public.payout_methods add column if not exists rzp_fund_account_id text;
alter table public.payout_requests add column if not exists rzp_payout_id text;
alter table public.payout_requests add column if not exists rzp_status text;
-- what was sent (so a payout whose answer was lost is sent again with exactly the same fund account and amount)
alter table public.payout_requests add column if not exists rzp_fund_account_id text;
alter table public.payout_requests add column if not exists rzp_amount_paise bigint;
alter table public.payout_requests add column if not exists rzp_mode text;
create unique index if not exists payout_requests_rzp_payout on public.payout_requests (rzp_payout_id) where rzp_payout_id is not null;

create table if not exists public.razorpay_events (
  event_id text primary key check (length(event_id) between 1 and 120),
  received_at timestamptz not null default now()
);
alter table public.razorpay_events enable row level security;
revoke all on public.razorpay_events from public, anon, authenticated;

-- New payout details need a new Razorpay fund account (the old one points at the old account).
create or replace function private.payout_methods_rzp_reset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.kind, new.account_number, new.ifsc, new.upi_id, new.holder_name) is distinct from (old.kind, old.account_number, old.ifsc, old.upi_id, old.holder_name)
     and new.rzp_fund_account_id is not distinct from old.rzp_fund_account_id then
    new.rzp_fund_account_id := null;
  end if;
  return new;
end $$;
revoke all on function private.payout_methods_rzp_reset() from public, anon, authenticated;
drop trigger if exists payout_methods_rzp_reset on public.payout_methods;
create trigger payout_methods_rzp_reset before update on public.payout_methods for each row execute function private.payout_methods_rzp_reset();

-- Are the saved details exactly the ones a request was made with? (kind, holder, account, IFSC, UPI ID)
create or replace function private.payout_method_matches(m public.payout_methods, s jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select m.profile_id is not null and s is not null
     and (m.kind, m.holder_name, m.account_number, m.ifsc, m.upi_id)
         is not distinct from (s ->> 'kind', s ->> 'holderName', s ->> 'accountNumber', s ->> 'ifsc', s ->> 'upiId')
$$;
revoke all on function private.payout_method_matches(public.payout_methods, jsonb) from public, anon, authenticated;

-- Is this person (not the signed-in user: the server passes the Accountant) in the Accounts department, or the Super Admin?
create or replace function private.payout_actor_is_accounts(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles x left join public.departments d on d.id = x.department_id
                  where x.id = p and x.status = 'ACTIVE' and (x.role = 'SUPER_ADMIN' or d.slug = 'accounts'))
$$;
revoke all on function private.payout_actor_is_accounts(uuid) from public, anon, authenticated;

create or replace function public.payout_rzp_begin(p_id uuid, p_actor uuid, p_tds numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.payout_requests;
  m public.payout_methods;
  owner_p public.profiles;
  v_tds numeric := round(coalesce(p_tds, 0), 2);
begin
  if not private.payout_actor_is_accounts(p_actor) then
    raise exception 'FORBIDDEN: Only the Accounts department can send payouts.' using errcode = '42501';
  end if;
  select * into r from public.payout_requests where id = p_id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: This withdrawal does not exist.' using errcode = 'P0001';
  end if;
  if r.profile_id = p_actor then
    raise exception 'FORBIDDEN: You cannot pay your own withdrawal.' using errcode = '42501';
  end if;
  if r.status <> 'REQUESTED' then
    raise exception 'CONFLICT: This withdrawal was already handled.' using errcode = 'P0001';
  end if;
  if coalesce(r.method_snapshot -> 'full' ->> 'kind', '') not in ('BANK', 'UPI') then
    raise exception 'VALIDATION_ERROR: Razorpay pays Indian bank accounts and UPI IDs only. Pay international details by hand.' using errcode = 'P0001';
  end if;
  if v_tds < 0 or v_tds >= r.amount then
    raise exception 'VALIDATION_ERROR: TDS must be at least 0 and less than the amount.' using errcode = 'P0001';
  end if;
  select * into m from public.payout_methods where profile_id = r.profile_id;
  select * into owner_p from public.profiles where id = r.profile_id;
  update public.payout_requests set status = 'PROCESSING', channel = 'RAZORPAY', tds_amount = v_tds, net_amount = r.amount - v_tds,
         decided_by = p_actor, decided_at = now(), rzp_status = 'starting'
   where id = r.id returning * into r;
  perform private.write_audit('PAYOUT_RAZORPAY_STARTED', 'payout_request', r.id, owner_p.department_id, owner_p.team_id,
    jsonb_build_object('amount', r.amount, 'tds', v_tds, 'net', r.net_amount, 'actor', p_actor));
  return private.payout_request_json(r, true) || jsonb_build_object(
    'email', owner_p.email, 'phone', owner_p.phone,
    -- the fund account is reused only if it was made for these same details
    'contactId', m.rzp_contact_id,
    'fundAccountId', case when private.payout_method_matches(m, r.method_snapshot -> 'full') then m.rzp_fund_account_id end);
end $$;
revoke all on function public.payout_rzp_begin(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.payout_rzp_begin(uuid, uuid, numeric) to service_role;

-- The Razorpay contact and fund account made for a request. The fund account is kept on the person's details for next time only if their
-- details are still the ones the request was made with (if they changed meanwhile, it points at the old account and must not be reused).
drop function if exists public.payout_rzp_link(uuid, text, text);
create or replace function public.payout_rzp_link(p_id uuid, p_contact text, p_fund text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.payout_requests;
begin
  select * into r from public.payout_requests where id = p_id;
  if r.id is null then
    raise exception 'NOT_FOUND: This withdrawal does not exist.' using errcode = 'P0001';
  end if;
  update public.payout_requests set rzp_fund_account_id = p_fund where id = r.id;
  update public.payout_methods m set rzp_contact_id = coalesce(p_contact, m.rzp_contact_id),
         rzp_fund_account_id = case when private.payout_method_matches(m, r.method_snapshot -> 'full') then p_fund else m.rzp_fund_account_id end
   where m.profile_id = r.profile_id;
end $$;
revoke all on function public.payout_rzp_link(uuid, text, text) from public, anon, authenticated;
grant execute on function public.payout_rzp_link(uuid, text, text) to service_role;

-- Right before the payout call: what is sent. From here on the request is never put back to waiting: if the answer is lost, the
-- status check sends the same payout again with the same idempotency key (Razorpay returns the payout it already made).
drop function if exists public.payout_rzp_prepare(uuid, text, bigint);
create or replace function public.payout_rzp_prepare(p_id uuid, p_fund text, p_paise bigint, p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payout_requests set rzp_fund_account_id = p_fund, rzp_amount_paise = p_paise, rzp_mode = p_mode, rzp_status = 'sending'
   where id = p_id and status = 'PROCESSING' and rzp_payout_id is null;
  if not found then
    raise exception 'CONFLICT: This withdrawal is not being sent.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.payout_rzp_prepare(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.payout_rzp_prepare(uuid, text, bigint, text) to service_role;

create or replace function public.payout_rzp_set_id(p_id uuid, p_payout text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payout_requests set rzp_payout_id = p_payout, rzp_status = 'created' where id = p_id and status = 'PROCESSING';
  if not found then
    raise exception 'CONFLICT: This withdrawal is not being sent.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.payout_rzp_set_id(uuid, text) from public, anon, authenticated;
grant execute on function public.payout_rzp_set_id(uuid, text) to service_role;

-- Razorpay said no before a payout existed (bad details, low balance on a non-queued account, keys wrong): back to waiting.
create or replace function public.payout_rzp_undo(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.payout_requests;
begin
  select * into r from public.payout_requests where id = p_id for update;
  if r.id is null or r.status <> 'PROCESSING' or r.rzp_payout_id is not null then
    raise exception 'CONFLICT: Only a payout Razorpay has not accepted yet can be put back.' using errcode = 'P0001';
  end if;
  update public.payout_requests set status = 'REQUESTED', channel = null, tds_amount = 0, net_amount = null, decided_by = null, decided_at = null,
         rzp_status = null, rzp_fund_account_id = null, rzp_amount_paise = null, rzp_mode = null where id = r.id returning * into r;
  perform private.write_audit('PAYOUT_RAZORPAY_UNDONE', 'payout_request', r.id, null, null, jsonb_build_object('reason', left(p_reason, 300)));
  return private.payout_request_json(r, true);
end $$;
revoke all on function public.payout_rzp_undo(uuid, text) from public, anon, authenticated;
grant execute on function public.payout_rzp_undo(uuid, text) to service_role;

-- A status from the webhook (with its event id) or from a status check (no event id). p_reference is the payout's reference_id (the
-- request id without dashes): it finds a request whose payout id was not recorded yet (a webhook faster than the API, or a lost answer).
-- An event is recorded as seen only when it matched a request, so Razorpay's retry of an unmatched one can still settle it.
drop function if exists public.payout_rzp_settle(text, text, text, text, text);
create or replace function public.payout_rzp_settle(p_payout text, p_status text, p_utr text, p_reason text, p_event_id text, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.payout_requests;
  owner_p public.profiles;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_exp jsonb;
begin
  select * into r from public.payout_requests where rzp_payout_id = p_payout for update;
  if r.id is null and nullif(btrim(p_reference), '') is not null then
    select * into r from public.payout_requests
     where replace(id::text, '-', '') = lower(btrim(p_reference)) and status = 'PROCESSING' and channel = 'RAZORPAY' and rzp_payout_id is null for update;
    if r.id is not null then
      update public.payout_requests set rzp_payout_id = p_payout where id = r.id returning * into r;
    end if;
  end if;
  if r.id is null then
    return jsonb_build_object('matched', false);
  end if;
  if p_event_id is not null then
    insert into public.razorpay_events (event_id) values (left(p_event_id, 120)) on conflict do nothing;
    if not found then
      return jsonb_build_object('matched', true, 'ignored', true, 'status', r.status);
    end if;
  end if;
  select * into owner_p from public.profiles where id = r.profile_id;
  if r.status = 'PROCESSING' and v_status = 'processed' then
    update public.payout_requests set rzp_status = v_status where id = r.id;
    r := private.payout_settle(r, coalesce(nullif(btrim(p_utr), ''), p_payout), private.office_today(), r.tds_amount, 'RAZORPAY', r.decided_by);
  elsif r.status = 'PROCESSING' and v_status in ('failed', 'rejected', 'cancelled', 'reversed') then
    -- reversed before it was ever processed is a failure too: the money came back, the amount is free again
    update public.payout_requests set status = 'FAILED', rzp_status = v_status, reason = left(coalesce(nullif(btrim(p_reason), ''), 'Razorpay could not send the payout.'), 500)
     where id = r.id returning * into r;
    perform private.write_audit('PAYOUT_FAILED', 'payout_request', r.id, owner_p.department_id, owner_p.team_id, jsonb_build_object('status', v_status, 'reason', r.reason));
    perform private.notify(r.profile_id, 'PAYOUT_FAILED', 'Your withdrawal could not be sent',
      format('%s The amount is available again; check your payout details and ask again.', r.reason), 'payout_request', r.id);
  elsif r.status = 'PAID' and v_status = 'reversed' then
    select to_jsonb(e) into v_exp from public.department_expenses e where e.id = r.expense_id;
    delete from public.department_expenses where id = r.expense_id;
    update public.payout_requests set status = 'REVERSED', rzp_status = v_status, expense_id = null,
           reason = left(coalesce(nullif(btrim(p_reason), ''), 'The bank returned the payout.'), 500)
     where id = r.id returning * into r;
    perform private.write_audit('PAYOUT_REVERSED', 'payout_request', r.id, owner_p.department_id, owner_p.team_id,
      jsonb_build_object('reason', r.reason, 'expense', v_exp));
    perform private.notify(r.profile_id, 'PAYOUT_REVERSED', 'Your withdrawal came back',
      format('The bank returned ₹%s: %s The amount is available again.', to_char(r.net_amount, 'FM99,99,99,990.00'), r.reason), 'payout_request', r.id);
  elsif r.status = 'PROCESSING' and v_status in ('queued', 'pending', 'processing', 'created') then
    update public.payout_requests set rzp_status = v_status where id = r.id returning * into r;
  end if;
  return jsonb_build_object('matched', true, 'status', r.status);
end $$;
revoke all on function public.payout_rzp_settle(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.payout_rzp_settle(text, text, text, text, text, text) to service_role;

-- Withdrawals still being sent after this many minutes, for the status check: with a payout id (ask Razorpay), or without one (the answer
-- was lost: send again with the same key, fund account and amount; or the payout call was never made: put it back to waiting).
create or replace function public.payout_rzp_pending(p_minutes integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'payoutId', r.rzp_payout_id, 'rzpStatus', r.rzp_status,
                                               'fundAccountId', r.rzp_fund_account_id, 'amountPaise', r.rzp_amount_paise, 'mode', r.rzp_mode) order by r.decided_at), '[]'::jsonb)
    from (select * from public.payout_requests
           where status = 'PROCESSING' and channel = 'RAZORPAY' and decided_at < now() - make_interval(mins => greatest(coalesce(p_minutes, 10), 0))
           order by decided_at limit 50) r
$$;
revoke all on function public.payout_rzp_pending(integer) from public, anon, authenticated;
grant execute on function public.payout_rzp_pending(integer) to service_role;

-- The Razorpay payout behind a request (for the Check status button; the API has already checked the Accountant).
create or replace function public.payout_rzp_lookup(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'payoutId', r.rzp_payout_id, 'profileId', r.profile_id, 'rzpStatus', r.rzp_status,
                            'fundAccountId', r.rzp_fund_account_id, 'amountPaise', r.rzp_amount_paise, 'mode', r.rzp_mode, 'channel', r.channel)
    from public.payout_requests r where r.id = p_id
$$;
revoke all on function public.payout_rzp_lookup(uuid) from public, anon, authenticated;
grant execute on function public.payout_rzp_lookup(uuid) to service_role;
