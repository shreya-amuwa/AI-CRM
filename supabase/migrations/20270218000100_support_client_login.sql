-- =============================================================================
-- Support: "Create login" on the customer's Client login card (docs/SUPPORT_CLIENT_LOGIN.md). Run after every earlier migration. Safe to run twice.
--
-- Until now a client login was made only by the import (a "Client Login E-mail" column) or by Accounts after a verified payment. A customer added
-- without one (for example by the Google Sheet sync with that column empty) had no way to get a login from the Support side. Now the Support team
-- member who looks after the customer (the same people who may send a set-password link: private.may_update_support_customer) can create it:
--   1. support_client_login_begin checks who, that the customer has no login and that the e-mail is free, and returns where to send the e-mail;
--   2. the API creates the sign-in (Supabase Auth, a random password nobody knows) and e-mails the "Set your password" link;
--   3. support_client_login_record saves it (checking again that the sign-in was made for this customer), logs it and audits it.
-- Nothing else changes: Accounts' path, the import and the sheet sync work as before. No data is changed or deleted.
-- =============================================================================

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
    -- the Support team member who looks after the customer may create it (support_client_login_begin); Accounts keeps its own path
    return jsonb_build_object('hasLogin', false, 'canSend', false,
      'canCreate', private.may_work_in_support() and private.may_update_support_customer(p_customer),
      'suggestedEmail', (select nullif(lower(btrim(c.email)), '') from public.customers c where c.id = p_customer));
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

create or replace function public.support_client_login_begin(p_customer uuid, p_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_email text;
begin
  if p_customer is null or auth.uid() is null or not private.may_work_in_support() or not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  if c.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer already has a login.' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(nullif(btrim(p_email), ''), c.email, '')));
  if v_email = '' then
    raise exception 'VALIDATION_ERROR: Enter the e-mail the client will sign in with.' using errcode = 'P0001';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email)
     or exists (select 1 from public.profiles p where lower(p.email) = v_email)
     or exists (select 1 from public.customer_client_accounts a where lower(a.email) = v_email) then
    raise exception 'CONFLICT: % already has a login. Use a different e-mail for the client.', v_email using errcode = 'P0001';
  end if;
  return jsonb_build_object('email', v_email, 'name', c.name, 'businessName', coalesce(nullif(btrim(c.company), ''), c.name));
end $$;
revoke all on function public.support_client_login_begin(uuid, text) from public, anon;
grant execute on function public.support_client_login_begin(uuid, text) to authenticated;

create or replace function public.support_client_login_record(p_customer uuid, p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if p_customer is null or auth.uid() is null or not private.may_work_in_support() or not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u
                  where u.id = p_user_id and lower(u.email) = v_email
                    and u.raw_app_meta_data ->> 'client_customer_id' = p_customer::text) then
    raise exception 'VALIDATION_ERROR: The client login was not created for this customer.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  begin
    insert into public.customer_client_accounts (customer_id, auth_user_id, email, created_by)
    values (p_customer, p_user_id, v_email, private.my_id());
  exception when unique_violation then
    raise exception 'CONFLICT: This customer already has a login.' using errcode = 'P0001';
  end;
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_CREATED', format('Client login created by the Support team (%s)', v_email));
  perform private.write_audit('CLIENT_LOGIN_CREATED', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('email', v_email, 'via', 'support'));
end $$;
revoke all on function public.support_client_login_record(uuid, uuid, text) from public, anon;
grant execute on function public.support_client_login_record(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
