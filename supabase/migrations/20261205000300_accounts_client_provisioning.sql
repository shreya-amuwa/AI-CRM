-- Client login and profile creation belongs to Accounts, for every service.
--
-- Until now the Technical Consultant typed a password and created the client's panel login for WhatsApp customers, and the password was kept
-- (encrypted) until the "Status Completed" e-mail carried it to the client. Now:
--   * Accounts creates the login of any customer with a verified payment, whatever the service. The Technical Consultant has no part in it.
--   * The e-mail is the one on the customer record (never typed in the request). Accounts can correct a wrong record with a reason, audited.
--   * Nobody chooses, sees, stores or sends a password. The login is made with a random password nobody knows and the client gets a
--     one-time "set your password" link by e-mail (the link is made when the e-mail is sent and is never stored).
--   * The "account created" message is queued only after the login is saved, once per customer and channel.
--   * "Meta Verification completed" is its own explicit event. It is no longer implied by a login existing.
-- Rerunnable. No existing login, password, e-mail or invoice reference is touched.

-- ---------------------------------------------------------------------------
-- 1. Outbox: the new message and no stored passwords
-- ---------------------------------------------------------------------------
alter table public.automation_jobs drop constraint if exists automation_jobs_stage_check;
alter table public.automation_jobs add constraint automation_jobs_stage_check
  check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED', 'WEBSITE_READY', 'ACCOUNTS_PAYMENT', 'ACCOUNT_CREATED'));

-- An encrypted client password is never kept again; erase what is still waiting for a "Status Completed" e-mail that carried it.
update public.automation_jobs set secret = null where secret is not null;

alter table public.customer_onboarding
  add column if not exists meta_completed_at timestamptz,
  add column if not exists meta_completed_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Who may create a login, and the checks on the e-mail
-- ---------------------------------------------------------------------------
-- Accounts, for a customer whose payment has a verified amount, in any journey.
create or replace function private.accounts_may_create_login(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff() and exists (
    select 1 from public.customers c
     where c.id = p_customer
       and c.amount_verified > 0
       and c.lifecycle_stage in ('LEAD', 'ONBOARDING', 'CUSTOMER')
       and private.accounts_can_view(c.id))
$$;

-- Only Accounts manages a client login now (the Technical Consultant branch is gone).
create or replace function private.may_manage_client_account(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.accounts_may_create_login(p_customer)
$$;

-- null when the e-mail can be used for this customer's login; otherwise MISSING / INVALID / IN_USE.
-- A sign-in already made for THIS customer (a half-finished earlier attempt) does not count as "in use".
create or replace function private.client_email_problem(p_customer uuid, p_email text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when nullif(btrim(coalesce(p_email, '')), '') is null then 'MISSING'
    when lower(btrim(p_email)) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(btrim(p_email)) > 254 then 'INVALID'
    when exists (select 1 from auth.users u
                  where lower(u.email) = lower(btrim(p_email)) and coalesce(u.raw_app_meta_data ->> 'client_customer_id', '') <> p_customer::text)
      or exists (select 1 from public.profiles p where lower(p.email) = lower(btrim(p_email)))
      or exists (select 1 from public.customer_client_accounts a where lower(a.email) = lower(btrim(p_email)) and a.customer_id <> p_customer)
      then 'IN_USE'
    else null end
$$;

create or replace function public.assert_client_account_allowed(p_customer uuid, p_email text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_problem text;
begin
  if not private.may_manage_client_account(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer already has a login.' using errcode = 'P0001';
  end if;
  v_problem := private.client_email_problem(p_customer, p_email);
  if v_problem = 'MISSING' then
    raise exception 'VALIDATION_ERROR: This customer has no e-mail address on the record. Add a valid e-mail first.' using errcode = 'P0001';
  elsif v_problem = 'INVALID' then
    raise exception 'VALIDATION_ERROR: The e-mail on the customer record is not a valid e-mail address. Correct it first.' using errcode = 'P0001';
  elsif v_problem = 'IN_USE' then
    raise exception 'CONFLICT: That e-mail already has a login. Correct the e-mail on the customer record.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.assert_client_account_allowed(uuid, text) from public, anon;
grant execute on function public.assert_client_account_allowed(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Accounts corrects the e-mail on the record (reason required, audited), before any login exists
-- ---------------------------------------------------------------------------
create or replace function public.accounts_set_customer_email(p_customer uuid, p_email text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 300);
  v_problem text;
  pr public.customer_client_provisioning;
  v_mask text := '(none)';
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer already has a login. The login''s e-mail is not changed here.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Give the reason for changing the e-mail.' using errcode = 'P0001';
  end if;
  v_problem := private.client_email_problem(p_customer, v_email);
  if v_problem in ('MISSING', 'INVALID') then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  elsif v_problem = 'IN_USE' then
    raise exception 'CONFLICT: That e-mail already has a login. Use a different e-mail for the client.' using errcode = 'P0001';
  end if;
  select * into pr from public.customer_client_provisioning where customer_id = p_customer for update;
  if pr.customer_id is not null and pr.status = 'PENDING' and pr.updated_at > now() - interval '2 minutes' then
    raise exception 'CONFLICT: The login is being created right now. Wait a moment and refresh.' using errcode = 'P0001';
  end if;
  if lower(coalesce(v.email, '')) = v_email then
    return;
  end if;
  if v.email is not null and position('@' in v.email) > 1 then
    v_mask := left(v.email, 1) || '***' || substr(v.email, position('@' in v.email));
  end if;
  update public.customers set email = v_email, updated_at = now(), updated_by = (select private.my_id()) where id = p_customer;
  perform private.log_customer_activity(p_customer, 'CLIENT_EMAIL_CORRECTED', 'Accounts corrected the customer e-mail before creating the login · ' || v_reason);
  perform private.write_audit('CLIENT_EMAIL_CORRECTED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('from', v_mask, 'to', left(v_email, 1) || '***' || substr(v_email, position('@' in v_email)), 'reason', v_reason));
end $$;
revoke all on function public.accounts_set_customer_email(uuid, text, text) from public, anon;
grant execute on function public.accounts_set_customer_email(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Starting, failing and recording a login (the e-mail always comes from the customer record)
-- ---------------------------------------------------------------------------
drop function if exists public.accounts_client_login_begin(uuid, text);
create or replace function public.accounts_client_login_begin(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  pr public.customer_client_provisioning;
  v_email text;
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not private.accounts_may_create_login(p_customer) then
    raise exception 'CONFLICT: Verify a payment first. The client login is created once a payment is verified.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer already has a login.' using errcode = 'P0001';
  end if;
  select * into pr from public.customer_client_provisioning where customer_id = p_customer for update;
  if pr.customer_id is not null and pr.status = 'PENDING' and pr.updated_at > now() - interval '2 minutes' then
    raise exception 'CONFLICT: The login is already being created. Wait a moment and refresh.' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(v.email, '')));
  perform public.assert_client_account_allowed(p_customer, v_email);
  insert into public.customer_client_provisioning (customer_id, status, email, attempts, requested_by, requested_at, updated_at)
  values (p_customer, 'PENDING', v_email, 1, (select private.my_id()), now(), now())
  on conflict (customer_id) do update
    set status = 'PENDING', email = excluded.email, attempts = public.customer_client_provisioning.attempts + 1,
        last_error = null, requested_by = excluded.requested_by, requested_at = now(), updated_at = now();
  update public.customers set updated_at = now() where id = p_customer;
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_REQUESTED', 'Accounts started creating the client login');
  return jsonb_build_object('status', 'PENDING', 'email', v_email, 'name', v.name, 'businessName', coalesce(nullif(btrim(v.company), ''), v.name));
end $$;
revoke all on function public.accounts_client_login_begin(uuid) from public, anon;
grant execute on function public.accounts_client_login_begin(uuid) to authenticated;

-- the failure is shown to Accounts with its reason; nothing about the sign-in service's secrets is ever in it (the API sends a safe sentence)
create or replace function public.accounts_client_login_failed(p_customer uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  update public.customer_client_provisioning
     set status = 'FAILED', last_error = left(coalesce(nullif(btrim(p_message), ''), 'The login could not be created.'), 300), updated_at = now()
   where customer_id = p_customer and status = 'PENDING';
  update public.customers set updated_at = now() where id = p_customer;
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_FAILED', 'Creating the client login failed. Accounts can try again.');
  perform private.write_audit('CLIENT_LOGIN_FAILED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('reason', left(coalesce(p_message, ''), 300)));
end $$;

-- The login the API made (random password nobody knows) is saved against the customer, and only then is the "account created" message queued.
drop function if exists public.record_client_account(uuid, uuid, text, text);
create or replace function public.record_client_account(p_customer uuid, p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  pr public.customer_client_provisioning;
  v_email text := lower(trim(coalesce(p_email, '')));
  ch text;
begin
  if not private.may_manage_client_account(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into pr from public.customer_client_provisioning where customer_id = p_customer for update;
  if pr.customer_id is null or pr.status <> 'PENDING' then
    raise exception 'CONFLICT: Start creating the client login first.' using errcode = 'P0001';
  end if;
  if v_email = '' or v_email <> lower(btrim(coalesce(v.email, ''))) or v_email <> lower(coalesce(pr.email, '')) then
    raise exception 'VALIDATION_ERROR: The login''s e-mail must be the e-mail on the customer record.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u
                  where u.id = p_user_id and lower(u.email) = v_email
                    and u.raw_app_meta_data ->> 'client_customer_id' = p_customer::text) then
    raise exception 'VALIDATION_ERROR: The client login was not created for this customer.' using errcode = 'P0001';
  end if;
  insert into public.customer_client_accounts (customer_id, auth_user_id, email, created_by)
  values (p_customer, p_user_id, v_email, (select private.my_id()));
  -- queued only now (the login exists); once per customer and channel, however often this is retried
  foreach ch in array array['EMAIL', 'WHATSAPP'] loop
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, created_by)
    values (p_customer, ch, 'ACCOUNT_CREATED', format('ACCOUNT|%s|%s', p_customer, ch), (select private.my_id()))
    on conflict (dedupe_key) do nothing;
  end loop;
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_CREATED', 'Client login created by Accounts · set-password e-mail and WhatsApp queued');
  perform private.write_audit('CLIENT_LOGIN_CREATED', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('via', 'accounts'));
end $$;
revoke all on function public.record_client_account(uuid, uuid, text) from public, anon;
grant execute on function public.record_client_account(uuid, uuid, text) to authenticated;

-- The API looks here for a sign-in a crashed attempt left behind (same customer, same e-mail) and finishes it instead of making a second one.
create or replace function public.client_auth_user_for(p_customer uuid, p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
   where lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.raw_app_meta_data ->> 'client_customer_id' = p_customer::text
   limit 1
$$;
revoke all on function public.client_auth_user_for(uuid, text) from public, anon, authenticated;
grant execute on function public.client_auth_user_for(uuid, text) to service_role;

-- Send the account e-mail again (the first failed, was skipped, or the client lost it). A failed one is retried as the SAME job; a delivered
-- one is repeated at most every 10 minutes, as a new numbered job, so it is never sent twice by accident.
create or replace function public.accounts_resend_account_email(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  j public.automation_jobs;
  n integer;
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: Create the client login first.' using errcode = 'P0001';
  end if;
  select * into j from public.automation_jobs
   where customer_id = p_customer and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED' order by created_at desc limit 1 for update;
  if j.id is null then
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, created_by)
    values (p_customer, 'EMAIL', 'ACCOUNT_CREATED', format('ACCOUNT|%s|EMAIL', p_customer), (select private.my_id()))
    on conflict (dedupe_key) do nothing;
  elsif j.status in ('QUEUED', 'SENDING') then
    raise exception 'CONFLICT: The e-mail is already on its way.' using errcode = 'P0001';
  elsif j.status in ('FAILED', 'SKIPPED', 'CANCELLED') then
    update public.automation_jobs set status = 'QUEUED', attempts = 0, next_attempt_at = now(), locked_until = null, detail = null where id = j.id;
  elsif j.sent_at is not null and j.sent_at > now() - interval '10 minutes' then
    raise exception 'CONFLICT: The e-mail was sent a moment ago. Wait before sending it again.' using errcode = 'P0001';
  else
    select count(*) + 1 into n from public.automation_jobs where customer_id = p_customer and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED';
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, created_by)
    values (p_customer, 'EMAIL', 'ACCOUNT_CREATED', format('ACCOUNT|%s|EMAIL|%s', p_customer, n), (select private.my_id()))
    on conflict (dedupe_key) do nothing;
  end if;
  perform private.log_customer_activity(p_customer, 'CLIENT_ACCOUNT_EMAIL_RESENT', 'Accounts sent the set-password e-mail again');
  perform private.write_audit('CLIENT_ACCOUNT_EMAIL_RESENT', 'customer', p_customer, v.department_id, v.team_id, '{}'::jsonb);
  return jsonb_build_object('queued', true);
end $$;
revoke all on function public.accounts_resend_account_email(uuid) from public, anon;
grant execute on function public.accounts_resend_account_email(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Accounts queue: who has a login, who is waiting, who failed and why
-- ---------------------------------------------------------------------------
-- the customers the queue is about: a verified payment, still being served; with the state of their login
create or replace function private.prov_base(p_term text)
returns table (customer_id uuid, login_status text, sort_key integer, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id,
         case when a.customer_id is not null then 'CREATED' else coalesce(pr.status, 'NOT_STARTED') end,
         case when a.customer_id is not null then 3 when pr.status = 'FAILED' then 0 when pr.status = 'PENDING' then 2 else 1 end,
         coalesce(a.created_at, pr.updated_at, c.updated_at)
    from public.customers c
    left join public.customer_client_accounts a on a.customer_id = c.id
    left join public.customer_client_provisioning pr on pr.customer_id = c.id
   where private.is_accounts_staff() and c.amount_verified > 0 and c.lifecycle_stage in ('LEAD', 'ONBOARDING', 'CUSTOMER')
     and private.accounts_can_view(c.id)
     and (p_term is null or c.search_text ilike '%' || p_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || p_term || '%')
$$;

create or replace function public.accounts_provisioning_queue(p_status text default 'ALL', p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_status text := upper(coalesce(nullif(btrim(p_status), ''), 'ALL'));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total integer;
  v_counts jsonb;
  v_items jsonb;
begin
  perform private.require_accounts_staff();
  if v_status not in ('ALL', 'NOT_STARTED', 'PENDING', 'FAILED', 'CREATED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;

  select jsonb_build_object('ALL', count(*), 'NOT_STARTED', count(*) filter (where login_status = 'NOT_STARTED'),
                            'PENDING', count(*) filter (where login_status = 'PENDING'), 'FAILED', count(*) filter (where login_status = 'FAILED'),
                            'CREATED', count(*) filter (where login_status = 'CREATED'))
    into v_counts from private.prov_base(v_term);
  select count(*) into v_total from private.prov_base(v_term) where v_status = 'ALL' or login_status = v_status;

  select coalesce(jsonb_agg(row_json order by sort_key, updated_at desc), '[]'::jsonb) into v_items from (
    select b.sort_key, b.updated_at,
      jsonb_build_object(
        'customerId', c.id, 'code', c.customer_code, 'name', c.name, 'company', c.company,
        'email', c.email, 'emailProblem', case when a.customer_id is null then private.client_email_problem(c.id, c.email) end,
        'order', jsonb_build_object(
          'services', coalesce((select jsonb_agg(s.name order by s.sort_order) from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                                 where cs.customer_id = c.id), '[]'::jsonb),
          'dealAmount', c.deal_amount, 'verified', c.amount_verified,
          'balance', greatest(coalesce(c.deal_amount, 0) - c.amount_verified, 0), 'paymentStatus', c.payment_status),
        'journey', private.customer_journey(c.id),
        'status', b.login_status, 'attempts', coalesce(pr.attempts, 0),
        'lastError', case when b.login_status = 'FAILED' then pr.last_error end,
        'requestedAt', pr.requested_at, 'updatedAt', b.updated_at, 'createdAt', a.created_at,
        'createdBy', (select full_name from public.profiles where id = coalesce(a.created_by, pr.requested_by)),
        'loginEmail', a.email,
        'notification', case when a.customer_id is null then null else jsonb_build_object(
          'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'attempts', j.attempts)
                      from public.automation_jobs j where j.customer_id = c.id and j.channel = 'EMAIL' and j.stage = 'ACCOUNT_CREATED' order by j.created_at desc limit 1),
          'whatsapp', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'attempts', j.attempts)
                      from public.automation_jobs j where j.customer_id = c.id and j.channel = 'WHATSAPP' and j.stage = 'ACCOUNT_CREATED' order by j.created_at desc limit 1)) end,
        'can', jsonb_build_object(
          'create', a.customer_id is null and private.client_email_problem(c.id, c.email) is null
                    and (pr.customer_id is null or pr.status <> 'PENDING' or pr.updated_at <= now() - interval '2 minutes'),
          'fixEmail', a.customer_id is null,
          'resend', a.customer_id is not null)) as row_json
      from private.prov_base(v_term) b
      join public.customers c on c.id = b.customer_id
      left join public.customer_client_accounts a on a.customer_id = c.id
      left join public.customer_client_provisioning pr on pr.customer_id = c.id
     where v_status = 'ALL' or b.login_status = v_status
     order by b.sort_key, b.updated_at desc
     limit v_size offset (v_page - 1) * v_size) page;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'counts', v_counts);
end $$;
revoke all on function public.accounts_provisioning_queue(text, text, integer, integer) from public, anon;
grant execute on function public.accounts_provisioning_queue(text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Client status: a login no longer means "Meta Verification completed"
-- ---------------------------------------------------------------------------
create or replace function private.client_status_target(p_customer uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  e public.customer_onboarding_entries;
  v_site text := private.customer_website(p_customer);
  v_has_site boolean;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if o.customer_id is null or o.forwarded_to_support_at is null or o.consultant_started_at is null then
    return null; -- onboarding has not started yet
  end if;
  v_has_site := v_site is not null and v_site <> 'NO_WEBSITE';
  -- completed only when someone records that Meta completed the verification (never because a panel login exists)
  if o.meta_completed_at is not null then
    return 'COMPLETED';
  end if;
  select * into e from public.customer_onboarding_entries where customer_id = p_customer and item_code = 'WA_WEBSITE_URL';
  if o.returned_at is null and o.items_total > 0 and o.items_verified >= o.items_total and o.items_rejected = 0
     and v_has_site and e.status = 'VERIFIED' then
    return 'META_VERIFICATION';
  end if;
  return case when v_has_site then 'UNDER_REVIEW' else 'WEBSITE_PENDING' end;
end $$;

-- same as before, minus the password that used to ride along on the completed message
create or replace function private.advance_client_status(p_customer uuid, p_silent boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  v_target text;
  v_from text;
  ch text;
begin
  if not private.automation_eligible(p_customer) then
    return null;
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null then
    return null;
  end if;
  v_target := private.client_status_target(p_customer);
  if v_target is null or private.client_status_rank(v_target) <= private.client_status_rank(o.client_status) then
    return o.client_status; -- same stage again, or a backward move: nothing to send
  end if;
  -- Start stages are decided once: a customer that started at Website Pending goes
  -- straight to Meta Verification when the website is created (no Under Review email).
  if o.client_status = 'WEBSITE_PENDING' and v_target = 'UNDER_REVIEW' then
    return o.client_status;
  end if;
  v_from := o.client_status;
  update public.customer_onboarding set client_status = v_target, client_status_changed_at = now()
   where customer_id = p_customer;
  if p_silent then
    return v_target;
  end if;
  foreach ch in array array['EMAIL', 'WHATSAPP'] loop
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, created_by)
    values (p_customer, ch, v_target, format('ONBOARD|%s|%s|%s', p_customer, ch, v_target),
            jsonb_strip_nulls(jsonb_build_object('from', v_from)), (select private.my_id()))
    on conflict (dedupe_key) do nothing;
  end loop;
  perform private.log_customer_activity(p_customer, 'CLIENT_STATUS_CHANGED',
    format('Client status: %s - email and WhatsApp queued', initcap(replace(v_target, '_', ' '))));
  perform private.write_audit('CLIENT_STATUS_CHANGED', 'customer', p_customer,
    (select department_id from public.customers where id = p_customer), (select team_id from public.customers where id = p_customer),
    jsonb_build_object('from', v_from, 'to', v_target));
  return v_target;
end $$;

-- "Meta has completed the verification": recorded by the Department Head (or Super Admin), or by the Technical Consultant / Meta Verifier
-- who owns the customer's verification. Only after the application was submitted (the Meta Verification stage). Queues the completed message once.
create or replace function public.mark_meta_verification_completed(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
begin
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not (private.is_super_admin()
       or (private.my_role() = 'DEPARTMENT_HEAD' and v.department_id = private.my_department_id())
       or private.can_consult_customer(p_customer) or private.can_review_onboarding(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or not private.automation_eligible(p_customer) then
    raise exception 'CONFLICT: This customer has no Meta verification to complete.' using errcode = 'P0001';
  end if;
  if o.meta_completed_at is not null then
    return; -- already recorded: nothing is sent twice
  end if;
  if private.client_status_rank(coalesce(o.client_status, '')) < private.client_status_rank('META_VERIFICATION') then
    raise exception 'CONFLICT: Meta verification can be completed only after the documents are verified and the application is submitted.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set meta_completed_at = now(), meta_completed_by = (select private.my_id()) where customer_id = p_customer;
  perform private.advance_client_status(p_customer, false);
  perform private.log_customer_activity(p_customer, 'META_VERIFICATION_COMPLETED', 'Meta verification marked as completed');
  perform private.write_audit('META_VERIFICATION_COMPLETED', 'customer', p_customer, v.department_id, v.team_id, '{}'::jsonb);
end $$;
revoke all on function public.mark_meta_verification_completed(uuid) from public, anon;
grant execute on function public.mark_meta_verification_completed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. A failed "account created" message is Accounts' to fix (the rest as before)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.automation_finish_job(p_job uuid, p_outcome text, p_detail text DEFAULT NULL::text, p_response_code integer DEFAULT NULL::integer, p_recipient text DEFAULT NULL::text, p_provider_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  j public.automation_jobs;
  v public.customers;
  v_status text;
  v_recipient uuid;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into j from public.automation_jobs where id = p_job for update;
  if j.id is null or j.status <> 'SENDING' then
    raise exception 'CONFLICT: This job is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and j.attempts >= 5 then 'FAILED'
                   when p_outcome = 'RETRY' then 'QUEUED' else p_outcome end;
  update public.automation_jobs
     set status = v_status,
         detail = left(p_detail, 500),
         response_code = p_response_code,
         recipient = coalesce(left(p_recipient, 254), recipient),
         provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         locked_until = null,
         next_attempt_at = case when v_status = 'QUEUED'
                                then now() + (array[1, 5, 15, 60])[least(j.attempts, 4)] * interval '1 minute'
                                else next_attempt_at end,
         sent_at = case when v_status = 'SENT' then now() else sent_at end,
         secret = null
   where id = p_job
  returning * into j;

  if v_status in ('SENT', 'FAILED', 'SKIPPED') then
    select * into v from public.customers where id = j.customer_id;
    if not j.internal then
      perform private.log_customer_activity(j.customer_id, 'AUTOMATION_' || j.channel || '_' || v_status,
        format('%s %s: %s%s', initcap(replace(j.stage, '_', ' ')), case when j.channel = 'EMAIL' then 'email' else 'WhatsApp' end,
               lower(v_status), case when p_detail is not null and v_status <> 'SENT' then ' - ' || left(p_detail, 200) else '' end));
    end if;
    if v_status = 'FAILED' then
      perform private.write_audit('AUTOMATION_FAILED', 'customer', j.customer_id, v.department_id, v.team_id,
        jsonb_build_object('job', j.id, 'channel', j.channel, 'stage', j.stage, 'detail', left(p_detail, 200)));
      if j.internal then
        for v_recipient in
          select p.id from public.profiles p join public.departments d on d.id = p.department_id
           where p.status = 'ACTIVE' and d.slug = 'accounts'
        loop
          perform private.notify(v_recipient, 'AUTOMATION_FAILED', format('Payment email not sent: %s', coalesce(v.company, v.name)),
            format('The email about this payment request could not be sent after %s attempts: %s. The request is still in your queue.', j.attempts, coalesce(left(p_detail, 300), 'unknown error')),
            'customer', j.customer_id, '{}'::jsonb, 'urgent');
        end loop;
      elsif j.stage = 'ACCOUNT_CREATED' then
        for v_recipient in
          select p.id from public.profiles p join public.departments d on d.id = p.department_id
           where p.status = 'ACTIVE' and d.slug = 'accounts'
        loop
          perform private.notify(v_recipient, 'AUTOMATION_FAILED',
            format('Account %s not sent: %s', case when j.channel = 'EMAIL' then 'e-mail' else 'WhatsApp' end, coalesce(v.company, v.name)),
            format('The login was created, but the message to the client could not be sent after %s attempts: %s. Open Client Logins and send it again.', j.attempts, coalesce(left(p_detail, 300), 'unknown error')),
            'customer', j.customer_id, '{}'::jsonb, 'urgent');
        end loop;
      else
        for v_recipient in
          select p.id from public.profiles p join public.teams t on t.id = p.team_id
           where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
             and ((case when private.onboarding_route(v.id) = 'META' then p.is_meta_verifier else p.is_technical_consultant end) or p.role = 'TEAM_HEAD')
        loop
          perform private.notify(v_recipient, 'AUTOMATION_FAILED',
            format('%s not sent: %s', case when j.channel = 'EMAIL' then 'Email' else 'WhatsApp' end, coalesce(v.company, v.name)),
            format('The %s message could not be sent after %s attempts: %s', initcap(replace(j.stage, '_', ' ')), j.attempts, coalesce(left(p_detail, 300), 'unknown error')),
            'customer', j.customer_id, '{}'::jsonb, 'urgent');
        end loop;
      end if;
    end if;
  end if;
  return jsonb_build_object('id', j.id, 'status', j.status, 'attempts', j.attempts, 'nextAttemptAt', j.next_attempt_at);
end $function$;
