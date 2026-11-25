-- =============================================================================
-- Client set-password links sent by the team (follows 20261101000100_customer_usage_import.sql and 20261208000300_client_credentials.sql).
--
-- The client's relationship manager (anyone who may work on the support customer) and Accounts can send the client a new set-password
-- link from the customer's page, e.g. when the client did not set a password within the link's 24 hours. Until now this had no limit.
-- * At most one link every 2 minutes and 5 a day per customer, and 100 a day per sender (CONFLICT otherwise). A link counts once its
--   e-mail was accepted (client_password_link_sent), so a failed or test send uses nothing up. Every link is audited (who, which
--   customer; never the link).
-- * client_login_status: the "Client login" card: whether there is a login, whether the client chose a password (or signed in, without a
--   temporary password, before that was recorded), when the team last sent a link and until when it works (24 hours), how many today,
--   when the next can be sent.
-- Who may: unchanged from client_login_invite_target. Safe to run twice; pasteable in the SQL editor.
-- Rollback: drop the three functions and the table (the "send password link" route then fails until this is re-applied).
-- =============================================================================

create table if not exists public.client_password_link_sends (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  sent_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index if not exists client_password_link_sends_customer_idx on public.client_password_link_sends (customer_id, sent_at desc);
create index if not exists client_password_link_sends_sender_idx on public.client_password_link_sends (sent_by, sent_at desc);
alter table public.client_password_link_sends enable row level security;
revoke all on public.client_password_link_sends from public, anon, authenticated;

-- the limits, in one place
create or replace function private.client_link_limits()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('cooldownMinutes', 2, 'perCustomerDay', 5, 'perSenderDay', 100, 'linkHours', 24)
$$;
revoke all on function private.client_link_limits() from public, anon, authenticated;

create or replace function public.client_login_status(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a public.customer_client_accounts;
  v_lim jsonb := private.client_link_limits();
  v_last timestamptz;
  v_today integer;
  v_set timestamptz;
  v_next timestamptz;
begin
  if p_customer is null or not (private.may_update_support_customer(p_customer) or private.may_manage_client_account(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  if a.customer_id is null then
    return jsonb_build_object('hasLogin', false, 'canSend', false);
  end if;
  select max(s.sent_at), count(*) filter (where s.sent_at > now() - interval '24 hours') into v_last, v_today
    from public.client_password_link_sends s where s.customer_id = p_customer and s.sent_at > now() - interval '24 hours';
  -- a sign-in counts only without a temporary password still to change (signing in with a temporary one is not "set")
  v_set := coalesce(a.password_changed_at,
                    case when not coalesce(a.must_change_password, false) then (select u.last_sign_in_at from auth.users u where u.id = a.auth_user_id) end);
  v_next := case
    when v_today >= (v_lim ->> 'perCustomerDay')::int then
      (select min(s.sent_at) from public.client_password_link_sends s where s.customer_id = p_customer and s.sent_at > now() - interval '24 hours') + interval '24 hours'
    when v_last is not null and v_last > now() - make_interval(mins => (v_lim ->> 'cooldownMinutes')::int) then
      v_last + make_interval(mins => (v_lim ->> 'cooldownMinutes')::int)
    end;
  return jsonb_build_object(
    'hasLogin', true, 'email', a.email,
    'passwordSet', v_set is not null, 'passwordSetAt', v_set,
    'lastLinkSentAt', v_last,
    'linkExpiresAt', v_last + make_interval(hours => (v_lim ->> 'linkHours')::int),
    'sendsToday', coalesce(v_today, 0), 'perDay', (v_lim ->> 'perCustomerDay')::int,
    'canSend', v_next is null, 'nextSendAt', v_next);
end $$;
revoke all on function public.client_login_status(uuid) from public, anon;
grant execute on function public.client_login_status(uuid) to authenticated;

-- before the server makes and mails the link: checks who and the limits, and returns where to send it
create or replace function public.client_password_link_begin(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.customer_client_accounts;
  c public.customers;
  v_me uuid := auth.uid();
  v_lim jsonb := private.client_link_limits();
  v_last timestamptz;
begin
  if p_customer is null or v_me is null or not (private.may_update_support_customer(p_customer) or private.may_manage_client_account(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  if a.customer_id is null then
    raise exception 'CONFLICT: This customer has no client login yet.' using errcode = 'P0001';
  end if;
  -- one at a time per customer (two people pressing the button together)
  perform pg_advisory_xact_lock(hashtextextended('client_password_link:' || p_customer::text, 0));
  select max(s.sent_at) into v_last from public.client_password_link_sends s where s.customer_id = p_customer;
  if v_last > now() - make_interval(mins => (v_lim ->> 'cooldownMinutes')::int) then
    raise exception 'CONFLICT: A link was sent to this client less than % minutes ago. Ask them to check their inbox and spam folder.', v_lim ->> 'cooldownMinutes'
      using errcode = 'P0001';
  end if;
  if (select count(*) from public.client_password_link_sends s where s.customer_id = p_customer and s.sent_at > now() - interval '24 hours')
       >= (v_lim ->> 'perCustomerDay')::int then
    raise exception 'CONFLICT: % links were already sent to this client in the last 24 hours. Try again tomorrow.', v_lim ->> 'perCustomerDay' using errcode = 'P0001';
  end if;
  if (select count(*) from public.client_password_link_sends s where s.sent_by = v_me and s.sent_at > now() - interval '24 hours')
       >= (v_lim ->> 'perSenderDay')::int then
    raise exception 'CONFLICT: You have sent % client links in the last 24 hours, the most allowed.', v_lim ->> 'perSenderDay' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  return jsonb_build_object('email', a.email, 'name', c.name, 'businessName', coalesce(nullif(btrim(c.company), ''), c.name));
end $$;
revoke all on function public.client_password_link_begin(uuid) from public, anon;
grant execute on function public.client_password_link_begin(uuid) to authenticated;

-- after the e-mail was accepted: the send counts towards the limits and is audited
create or replace function public.client_password_link_sent(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_me uuid := auth.uid();
begin
  if p_customer is null or v_me is null or not (private.may_update_support_customer(p_customer) or private.may_manage_client_account(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer has no client login yet.' using errcode = 'P0001';
  end if;
  insert into public.client_password_link_sends (customer_id, sent_by) values (p_customer, v_me);
  select * into c from public.customers where id = p_customer;
  perform private.write_audit('CLIENT_PASSWORD_LINK_REQUESTED', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('by', v_me));
end $$;
revoke all on function public.client_password_link_sent(uuid) from public, anon;
grant execute on function public.client_password_link_sent(uuid) to authenticated;
