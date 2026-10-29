-- =============================================================================
-- The 3 migrations of "automatic handover date + Crocodial", "payment e-mails to every Accounts member" and "credentials" (Accounts'
-- temporary password for the Client Dashboard, the Meta Verifier's WhatsApp panel password), in order.
-- Paste the whole file into the Supabase SQL editor and run it once. Every part is safe to run again; nothing is deleted and nothing is sent.
--   1. 20261208000100_handover_date_and_service_name.sql   first handover date set by the database; "Crocodile" -> "Crocodial"
--   2. 20261208000200_accounts_email_all_members.sql       a payment e-mail job for EVERY active Accounts member
--   3. 20261208000300_client_credentials.sql               temporary dashboard passwords, forced first-sign-in change, panel password e-mail
-- Needs the earlier migrations (up to 20261207000100) to be in place. Then deploy the app and set AUTOMATION_SECRET_KEY on the server:
-- without it the temporary password and the panel password are refused (nothing is stored unencrypted).
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261208000100_handover_date_and_service_name.sql
-- =============================================================================
-- 1. The handover date is the moment of the handover, set by the database.
-- 2. "Crocodile" is spelled "Crocodial".
--
-- 1. What was wrong
--   The onboarding header asked Sales to pick a "Target handover" date by hand ("Set date"), although the handover itself already happens
--   on a button click. customer_onboarding.forwarded_to_support_at is that moment (now() inside forward_to_consultant, never the browser's
--   clock), but it is cleared when the verifier sends the customer back, so the first handover was not kept, and a handover left no line
--   of its own in the customer's history.
--
--   Now: first_handed_over_at is written once (never overwritten, not even by a later handover) and every handover - the first and any
--   after a return - writes its own HANDED_OVER line in the customer history with the recipient's role. Both come from one trigger on the
--   same update that sets forwarded_to_support_at, so a retried request (which the send function already refuses: "Already sent") cannot
--   make a second event. Opening or editing the record changes nothing: only the null -> value change of forwarded_to_support_at counts.
--   The manual date column (target_handover_date) stays in the table for the records that have one; the screens no longer ask for it.
--
-- 2. The service is renamed in its one catalogue row (crm_services.name); its code, id, prices, routing, document requirements and every
--   customer's purchase stay as they are, and nothing is inserted. Names typed into history (invoice lines, audit text) are not rewritten.
--
-- Safe to run again. Changes no payment, invoice or total.
-- =============================================================================

alter table public.customer_onboarding add column if not exists first_handed_over_at timestamptz;

-- what happened before this migration: the first handover is the one still recorded (never invented for a customer not handed over)
update public.customer_onboarding set first_handed_over_at = forwarded_to_support_at where first_handed_over_at is null and forwarded_to_support_at is not null;

create or replace function private.tg_onboarding_handover()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_role text;
begin
  if new.forwarded_to_support_at is null or old.forwarded_to_support_at is not null then
    return new; -- only the moment the handover happens counts
  end if;
  -- the first handover is kept for good
  if old.first_handed_over_at is null then
    new.first_handed_over_at := new.forwarded_to_support_at;
  else
    new.first_handed_over_at := old.first_handed_over_at;
  end if;
  select * into c from public.customers where id = new.customer_id;
  v_role := case when private.onboarding_route(new.customer_id) = 'META' then 'Meta Verifier' else 'Technical Consultant' end;
  perform private.log_customer_activity(new.customer_id, 'HANDED_OVER',
    format('Handed over to the %s on %s', v_role, to_char(new.forwarded_to_support_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')));
  return new;
end $$;
revoke all on function private.tg_onboarding_handover() from public, anon, authenticated;
drop trigger if exists customer_onboarding_handover on public.customer_onboarding;
create trigger customer_onboarding_handover before update of forwarded_to_support_at on public.customer_onboarding
  for each row execute function private.tg_onboarding_handover();

-- the first handover cannot be edited by anyone through the table API (the trigger writes it)
revoke update (first_handed_over_at) on public.customer_onboarding from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Crocodial
-- ---------------------------------------------------------------------------
update public.crm_services set name = 'Crocodial (Call CRM)' where code = 'CROCODILE_CHANNEL_WEBHOOK' and name <> 'Crocodial (Call CRM)';

-- the usage import finds the service by either spelling (older sheets still say Crocodile)
create or replace function private.import_service_code(p text)
returns text language sql stable security definer set search_path = '' as $$
  with k as (select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) as v)
  select coalesce(
    (select s.code from public.crm_services s, k where lower(s.code) = k.v or lower(s.name) = k.v limit 1),
    (select a.code from k, (values
        ('whatsapp api', 'WHATSAPP_API_BLUE_TICK'), ('whatsapp api + blue tick', 'WHATSAPP_API_BLUE_TICK'), ('whatsapp', 'WHATSAPP_API_BLUE_TICK'),
        ('rcs registration + platform', 'RCS_REGISTRATION'), ('rcs', 'RCS_REGISTRATION'),
        ('voice message', 'VOICE_MESSAGE_BULK'), ('voice message (bulk)', 'VOICE_MESSAGE_BULK'), ('voice', 'VOICE_MESSAGE_BULK'),
        ('crocodial (call crm)', 'CROCODILE_CHANNEL_WEBHOOK'), ('crocodial', 'CROCODILE_CHANNEL_WEBHOOK'),
        -- the old spelling still finds the service in older sheets
        ('crocodile (call crm)', 'CROCODILE_CHANNEL_WEBHOOK'), ('crocodile', 'CROCODILE_CHANNEL_WEBHOOK'),
        ('gbp setup', 'GBP_SETUP'), ('gbp management', 'GBP_MANAGEMENT'), ('gmb ranking', 'GMB_RANKING'),
        ('meta ads', 'META_ADS_MANAGEMENT'), ('social media', 'SOCIAL_MEDIA_MANAGEMENT')) a(name, code)
      where a.name = k.v and exists (select 1 from public.crm_services s where s.code = a.code)))
$$;
revoke all on function private.import_service_code(text) from public, anon, authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261208000200_accounts_email_all_members.sql
-- =============================================================================
-- Payment requests are emailed to EVERY eligible Accounts member, not to one.
--
-- What was wrong (audit)
--   20261017000100_accounts_payment_email.sql chose "exactly one person per request": the accountant assigned to the customer, else the
--   lowest payment_desk_order, else the longest-serving Accounts person (private.payment_desk_email(), LIMIT 1). With two Accounts members
--   only one of them ever got the email; the bell notification already went to all of them. Nothing was hardcoded: the recipient came
--   from department membership, and the cut-off was the design.
--
-- Now
--   private.payment_desk_recipients(): every ACTIVE member of the Accounts department that has a valid e-mail address, once per address
--   (two profiles sharing an address are one recipient). One automation_jobs row per recipient, so each person's dispatch has its own
--   status, retries and log line; an invalid address or a provider failure on one never stops the other.
--   Only Accounts is emailed, and only for requests that wait for Accounts (PAYMENT_CONFIRMATION_REQUESTED, PAYMENT_TO_VERIFY,
--   ADDON_SUBMITTED). Customers have their own emails; nobody else is emailed.
--   The email carries the customer, its CRM reference, who sent it and what to do - no amounts and no customer phone / e-mail: Accounts
--   opens the request in the CRM for those.
--   payment_desk_order / accounts_owner_id no longer narrow the recipients (they stay for the CRM's own use).
--
-- Safe to run again. Nothing is sent by running it.
-- =============================================================================

create or replace function private.payment_desk_recipients()
returns table (profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct on (lower(btrim(p.email))) p.id, lower(btrim(p.email)), p.full_name
    from public.profiles p
    join public.departments d on d.id = p.department_id and d.slug = 'accounts'
   where p.status = 'ACTIVE' and p.email is not null and btrim(p.email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
   order by lower(btrim(p.email)), p.created_at, p.id
$$;
revoke all on function private.payment_desk_recipients() from public, anon, authenticated;

-- the older single-recipient function now answers with the first of the same list (kept for anything that still asks for one address)
create or replace function private.payment_desk_email(p_customer uuid)
returns table (profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select r.profile_id, r.email, r.full_name from private.payment_desk_recipients() r
   order by (select p.created_at from public.profiles p where p.id = r.profile_id), r.profile_id limit 1
$$;
revoke all on function private.payment_desk_email(uuid) from public, anon, authenticated;

create or replace function private.queue_accounts_email(p_kind text, p_customer uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v public.customers;
  s record;
begin
  select * into v from public.customers where id = p_customer;
  select p.full_name, dp.name as department into s
    from public.profiles p left join public.departments dp on dp.id = p.department_id where p.id = (select private.my_id());
  -- one job per recipient: its own status, retries and log line. (No body, amount, phone or e-mail of the customer goes into the job.)
  for d in select * from private.payment_desk_recipients() loop
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, internal, context, created_by)
    values (p_customer, 'EMAIL', 'ACCOUNTS_PAYMENT', format('ACCOUNTS|%s|%s|%s|%s', p_kind, p_customer, d.profile_id, gen_random_uuid()), true,
            jsonb_strip_nulls(jsonb_build_object(
              'to', d.email, 'toName', d.full_name, 'kind', p_kind, 'title', left(p_title, 200),
              'customer', coalesce(v.company, v.name), 'contact', v.name, 'reference', v.customer_code,
              'from', s.full_name, 'fromDepartment', s.department)),
            (select private.my_id()));
  end loop;
end $$;
revoke all on function private.queue_accounts_email(text, uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261208000300_client_credentials.sql
-- =============================================================================
-- Credentials: a temporary password for the Client Dashboard (Accounts) and the internal WhatsApp panel password (Meta Verifier).
--
-- Two DIFFERENT credentials, kept apart everywhere (tables, functions, e-mails, screens):
--   * Client Dashboard login   - Supabase Auth, created by Accounts, e-mail ON THE CUSTOMER RECORD.
--   * WhatsApp panel login     - an external panel; the account / user ID is on customer_services, the password is delivered by e-mail.
--
-- Client Dashboard
--   Until now the only way in was a one-time "set your password" link. Many customers (jewellers, mostly) never open it. Accounts can now
--   choose, per login, an ACCESS METHOD:
--     LINK       as before: a random password nobody knows and an e-mailed one-time link.
--     TEMPORARY  the server makes a random temporary password (nobody types it, the browser never sees it), the login is created with it,
--                and one e-mail carries the sign-in details. The client MUST choose their own password at the first sign-in:
--                customer_client_accounts.must_change_password makes every client function refuse until they have (private.require_client()).
--   The temporary password is encrypted by the API (AES-256-GCM, a key that lives only in the server environment), kept on that one e-mail
--   job and erased by the database the moment the job is sent, skipped or failed (and after 7 days at most). It is in no ordinary table, no
--   note, no activity and no audit line. Supabase Auth keeps only its own hash.
--
-- WhatsApp panel (Meta Verifier)
--   The CRM cannot set a password on the external panel: the Meta Verifier sets it THERE, then records it here ONLY to deliver it. The
--   password is encrypted by the API, queued on one e-mail job (stage PANEL_CREDENTIALS) to the customer's own e-mail, and erased after
--   delivery. What stays is a record that a password was set (who, when) and the state of the e-mail - never the password.
--
-- Safe to run again. No existing login, password, e-mail or invoice reference is touched. Nothing is sent by running it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------
alter table public.customer_client_accounts
  add column if not exists access_method text not null default 'LINK' check (access_method in ('LINK', 'TEMPORARY')),
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamptz;
alter table public.customer_client_provisioning
  add column if not exists access_method text not null default 'LINK' check (access_method in ('LINK', 'TEMPORARY'));

alter table public.automation_jobs drop constraint if exists automation_jobs_stage_check;
alter table public.automation_jobs add constraint automation_jobs_stage_check
  check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED', 'WEBSITE_READY', 'ACCOUNTS_PAYMENT', 'ACCOUNT_CREATED', 'PANEL_CREDENTIALS'));

-- A password was set for the customer's panel login of one service: who and when, and the e-mail that carried it. Never the password.
create table if not exists public.service_panel_credentials (
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code) on delete restrict,
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles (id) on delete set null,
  last_job uuid references public.automation_jobs (id) on delete set null,
  primary key (customer_id, service_code)
);
alter table public.service_panel_credentials enable row level security;
revoke all on public.service_panel_credentials from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Client Dashboard: begin with an access method
-- ---------------------------------------------------------------------------
create or replace function public.accounts_client_login_begin_method(p_customer uuid, p_method text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  pr public.customer_client_provisioning;
  v_email text;
  v_method text := upper(coalesce(nullif(btrim(p_method), ''), 'LINK'));
begin
  perform private.require_accounts_staff();
  if v_method not in ('LINK', 'TEMPORARY') then
    raise exception 'VALIDATION_ERROR: Choose how the client gets access.' using errcode = 'P0001';
  end if;
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
  insert into public.customer_client_provisioning (customer_id, status, email, attempts, requested_by, requested_at, updated_at, access_method)
  values (p_customer, 'PENDING', v_email, 1, (select private.my_id()), now(), now(), v_method)
  on conflict (customer_id) do update
    set status = 'PENDING', email = excluded.email, attempts = public.customer_client_provisioning.attempts + 1,
        last_error = null, requested_by = excluded.requested_by, requested_at = now(), updated_at = now(), access_method = excluded.access_method;
  update public.customers set updated_at = now() where id = p_customer;
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_REQUESTED',
    case when v_method = 'TEMPORARY' then 'Accounts started creating the client login with a temporary password' else 'Accounts started creating the client login' end);
  return jsonb_build_object('status', 'PENDING', 'email', v_email, 'name', v.name, 'businessName', coalesce(nullif(btrim(v.company), ''), v.name), 'method', v_method);
end $$;
revoke all on function public.accounts_client_login_begin_method(uuid, text) from public, anon;
grant execute on function public.accounts_client_login_begin_method(uuid, text) to authenticated;

-- the one-argument function (a caller that sends no method) is the same thing with the link
create or replace function public.accounts_client_login_begin(p_customer uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.accounts_client_login_begin_method(p_customer, 'LINK')
$$;
revoke all on function public.accounts_client_login_begin(uuid) from public, anon;
grant execute on function public.accounts_client_login_begin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Client Dashboard: save the login the API made, then queue the one e-mail (with the encrypted temporary password when that was chosen)
-- ---------------------------------------------------------------------------
create or replace function public.record_client_account_with_access(p_customer uuid, p_user_id uuid, p_email text, p_secret text default null)
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
  if pr.access_method = 'TEMPORARY' and nullif(p_secret, '') is null then
    raise exception 'VALIDATION_ERROR: The temporary password is missing.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_secret, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The credential is too long.' using errcode = 'P0001';
  end if;
  insert into public.customer_client_accounts (customer_id, auth_user_id, email, created_by, access_method, must_change_password)
  values (p_customer, p_user_id, v_email, (select private.my_id()), pr.access_method, pr.access_method = 'TEMPORARY');
  -- queued only now (the login exists); once per customer and channel, however often this is retried
  foreach ch in array array['EMAIL', 'WHATSAPP'] loop
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, secret, created_by)
    values (p_customer, ch, 'ACCOUNT_CREATED', format('ACCOUNT|%s|%s', p_customer, ch),
            case when ch = 'EMAIL' and pr.access_method = 'TEMPORARY' then jsonb_build_object('credential', 'TEMPORARY') else '{}'::jsonb end,
            case when ch = 'EMAIL' and pr.access_method = 'TEMPORARY' then p_secret end,
            (select private.my_id()))
    on conflict (dedupe_key) do nothing;
  end loop;
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_CREATED',
    case when pr.access_method = 'TEMPORARY' then 'Client login created by Accounts with a temporary password · sign-in e-mail and WhatsApp queued'
         else 'Client login created by Accounts · set-password e-mail and WhatsApp queued' end);
  perform private.write_audit('CLIENT_LOGIN_CREATED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('via', 'accounts', 'method', pr.access_method));
end $$;
revoke all on function public.record_client_account_with_access(uuid, uuid, text, text) from public, anon;
grant execute on function public.record_client_account_with_access(uuid, uuid, text, text) to authenticated;

create or replace function public.record_client_account(p_customer uuid, p_user_id uuid, p_email text)
returns void language sql security definer set search_path = '' as $$
  select public.record_client_account_with_access(p_customer, p_user_id, p_email, null)
$$;
revoke all on function public.record_client_account(uuid, uuid, text) from public, anon;
grant execute on function public.record_client_account(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Client Dashboard: what the login is now (for the resend), and sending again
-- ---------------------------------------------------------------------------
create or replace function public.accounts_client_account_state(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a public.customer_client_accounts;
begin
  perform private.require_accounts_staff();
  if not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  if a.customer_id is null then
    return jsonb_build_object('exists', false);
  end if;
  return jsonb_build_object('exists', true, 'authUserId', a.auth_user_id, 'email', a.email, 'accessMethod', a.access_method, 'mustChangePassword', a.must_change_password);
end $$;
revoke all on function public.accounts_client_account_state(uuid) from public, anon;
grant execute on function public.accounts_client_account_state(uuid) to authenticated;

-- Send the account e-mail again. With p_secret: a NEW temporary password for a login whose client has not chosen their own yet (the API
-- changed it in the sign-in service first); the old one no longer works. Without it: the set-password link (a client who has chosen their own
-- password is never given another temporary one). A failed e-mail is retried as the same job, a delivered one at most every 10 minutes.
create or replace function public.accounts_resend_account_email_with(p_customer uuid, p_secret text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  a public.customer_client_accounts;
  j public.automation_jobs;
  n integer;
  v_ctx jsonb := case when nullif(p_secret, '') is not null then jsonb_build_object('credential', 'TEMPORARY') else '{}'::jsonb end;
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  if a.customer_id is null then
    raise exception 'CONFLICT: Create the client login first.' using errcode = 'P0001';
  end if;
  if nullif(p_secret, '') is not null and not (a.access_method = 'TEMPORARY' and a.must_change_password) then
    raise exception 'CONFLICT: The client has chosen their own password. Send the set-password e-mail instead.' using errcode = 'P0001';
  end if;
  select * into j from public.automation_jobs
   where customer_id = p_customer and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED' order by created_at desc limit 1 for update;
  if j.id is null then
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, secret, created_by)
    values (p_customer, 'EMAIL', 'ACCOUNT_CREATED', format('ACCOUNT|%s|EMAIL', p_customer), v_ctx, nullif(p_secret, ''), (select private.my_id()))
    on conflict (dedupe_key) do nothing;
  elsif j.status in ('QUEUED', 'SENDING') then
    raise exception 'CONFLICT: The e-mail is already on its way.' using errcode = 'P0001';
  elsif j.status in ('FAILED', 'SKIPPED', 'CANCELLED') then
    update public.automation_jobs set status = 'QUEUED', attempts = 0, next_attempt_at = now(), locked_until = null, detail = null,
           context = v_ctx, secret = nullif(p_secret, '') where id = j.id;
  elsif j.sent_at is not null and j.sent_at > now() - interval '10 minutes' then
    raise exception 'CONFLICT: The e-mail was sent a moment ago. Wait before sending it again.' using errcode = 'P0001';
  else
    select count(*) + 1 into n from public.automation_jobs where customer_id = p_customer and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED';
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, secret, created_by)
    values (p_customer, 'EMAIL', 'ACCOUNT_CREATED', format('ACCOUNT|%s|EMAIL|%s', p_customer, n), v_ctx, nullif(p_secret, ''), (select private.my_id()))
    on conflict (dedupe_key) do nothing;
  end if;
  perform private.log_customer_activity(p_customer, 'CLIENT_ACCOUNT_EMAIL_RESENT',
    case when nullif(p_secret, '') is not null then 'Accounts sent the sign-in e-mail again with a new temporary password' else 'Accounts sent the set-password e-mail again' end);
  perform private.write_audit('CLIENT_ACCOUNT_EMAIL_RESENT', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('temporary', nullif(p_secret, '') is not null));
  return jsonb_build_object('queued', true);
end $$;
revoke all on function public.accounts_resend_account_email_with(uuid, text) from public, anon;
grant execute on function public.accounts_resend_account_email_with(uuid, text) to authenticated;

create or replace function public.accounts_resend_account_email(p_customer uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.accounts_resend_account_email_with(p_customer, null)
$$;
revoke all on function public.accounts_resend_account_email(uuid) from public, anon;
grant execute on function public.accounts_resend_account_email(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The first sign-in: the client chooses their own password before anything else
-- ---------------------------------------------------------------------------
-- the sign-in's customer whatever the state of its password (only client_me and the checks below use this)
create or replace function private.client_account_customer()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.customer_id from public.customer_client_accounts a where a.auth_user_id = auth.uid()
$$;
revoke all on function private.client_account_customer() from public, anon, authenticated;

-- A client who still holds a TEMPORARY password has no customer here: every client function (require_client), the chat, the ticket attachments
-- and the row-level policies that ask "which customer is this?" see nothing until they have chosen their own password.
create or replace function private.my_client_customer()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.customer_id from public.customer_client_accounts a where a.auth_user_id = auth.uid() and not a.must_change_password
$$;
revoke all on function private.my_client_customer() from public, anon, authenticated;
grant execute on function private.my_client_customer() to authenticated;

create or replace function private.require_client()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := private.client_account_customer();
begin
  if v is null then
    raise exception 'FORBIDDEN: This is available to clients only.' using errcode = '42501';
  end if;
  if private.my_client_customer() is null then
    raise exception 'FORBIDDEN: Choose your own password before you continue.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function private.require_client() from public, anon, authenticated;

-- who the client is and whether the temporary password still has to be replaced (the only client function that works before that)
create or replace function public.client_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.client_account_customer();
  c public.customers;
  a public.customer_client_accounts;
begin
  if v_customer is null then
    raise exception 'FORBIDDEN: This is available to clients only.' using errcode = '42501';
  end if;
  select * into c from public.customers where id = v_customer;
  select * into a from public.customer_client_accounts where customer_id = v_customer;
  return jsonb_build_object(
    'customerId', c.id, 'name', c.name, 'businessName', coalesce(nullif(btrim(c.company), ''), c.name),
    'email', c.email, 'phone', c.phone, 'segment', c.segment, 'status', c.status,
    'department', (select d.name from public.departments d where d.id = c.department_id),
    'loginEmail', a.email, 'clientSince', coalesce(c.customer_since::timestamptz, a.created_at, c.created_at),
    'loginId', a.auth_user_id, 'mustChangePassword', a.must_change_password);
end $$;

-- called by the API (service role) after it has put the client's own password in the sign-in service
create or replace function public.client_password_changed(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.customer_client_accounts;
  c public.customers;
begin
  select * into a from public.customer_client_accounts where auth_user_id = p_user for update;
  if a.customer_id is null then
    raise exception 'NOT_FOUND: Login not found.' using errcode = 'P0001';
  end if;
  update public.customer_client_accounts set must_change_password = false, password_changed_at = now() where customer_id = a.customer_id;
  select * into c from public.customers where id = a.customer_id;
  perform private.log_customer_activity(a.customer_id, 'CLIENT_PASSWORD_CHANGED', 'The client chose their own password');
  perform private.write_audit('CLIENT_PASSWORD_CHANGED', 'customer', a.customer_id, c.department_id, c.team_id, jsonb_build_object('after', a.access_method));
end $$;
revoke all on function public.client_password_changed(uuid) from public, anon, authenticated;
grant execute on function public.client_password_changed(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The Accounts queue also says how each login was made and whether the client has chosen their own password
-- ---------------------------------------------------------------------------
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
        'loginEmail', a.email, 'accessMethod', a.access_method, 'mustChangePassword', a.must_change_password, 'passwordChangedAt', a.password_changed_at,
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
-- 7. WhatsApp panel: the password of one service, delivered to the customer by e-mail (never kept)
-- ---------------------------------------------------------------------------
create or replace function public.panel_details_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_can boolean := private.can_manage_panel_details(p_customer);
begin
  -- readable by whoever manages it, and by the verifier's own department after the hand-over (they still need to see what was recorded)
  if not v_can and not (private.can_access_customer(p_customer)
       and exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_verifier_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'canEdit', v_can,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'platform', cs.platform, 'panelAccount', cs.panel_account,
                 -- whether a password was set for the customer and what happened to the e-mail that carried it (never the password itself)
                 'credentials', (select jsonb_build_object('setAt', pc.set_at, 'setBy', (select full_name from public.profiles where id = pc.set_by),
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = pc.last_job)) 
                                   from public.service_panel_credentials pc where pc.customer_id = cs.customer_id and pc.service_code = cs.service_code)) order by s.sort_order, s.code)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = p_customer and s.requires_meta_verification), '[]'::jsonb),
    -- the address the panel password is e-mailed to: the one on the customer record
    'customerEmail', (select nullif(btrim(c.email), '') from public.customers c where c.id = p_customer),
    'dashboardLogin', (select jsonb_build_object('email', a.email, 'createdAt', a.created_at) from public.customer_client_accounts a where a.customer_id = p_customer));
end $$;
revoke all on function public.panel_details_list(uuid) from public, anon;
grant execute on function public.panel_details_list(uuid) to authenticated;

-- The Meta Verifier set the password on the panel; this delivers it to the customer. p_secret is encrypted by the API. p_request makes a retried
-- click a no-op (one e-mail per request). Only whoever may manage this customer's panel details; the account / user ID must be saved first.
create or replace function public.panel_credentials_send(p_customer uuid, p_service text, p_secret text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  cs public.customer_services;
  v_name text;
  v_job uuid;
  v_email text;
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_request is null or nullif(p_secret, '') is null or length(p_secret) > 2000 then
    raise exception 'VALIDATION_ERROR: The password is missing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into cs from public.customer_services x
   where x.customer_id = p_customer and x.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = x.service_code and s.requires_meta_verification) for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: That is not a WhatsApp service of this customer.' using errcode = 'P0001';
  end if;
  if cs.panel_account is null then
    raise exception 'VALIDATION_ERROR: Save the account / user ID of this panel first.' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(v.email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: The customer has no valid e-mail address on the record. Ask Accounts to correct it, then send the panel login.' using errcode = 'P0001';
  end if;
  select name into v_name from public.crm_services where code = p_service;
  insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, secret, created_by)
  values (p_customer, 'EMAIL', 'PANEL_CREDENTIALS', format('PANEL|%s|%s|%s', p_customer, p_service, p_request),
          jsonb_strip_nulls(jsonb_build_object('service', p_service, 'serviceName', v_name, 'panel', cs.platform, 'account', cs.panel_account)),
          p_secret, (select private.my_id()))
  on conflict (dedupe_key) do nothing
  returning id into v_job;
  if v_job is null then
    return jsonb_build_object('queued', false, 'replayed', true);  -- the same request again: nothing more is sent
  end if;
  insert into public.service_panel_credentials (customer_id, service_code, set_at, set_by, last_job)
  values (p_customer, p_service, now(), (select private.my_id()), v_job)
  on conflict (customer_id, service_code) do update set set_at = now(), set_by = excluded.set_by, last_job = excluded.last_job;
  perform private.log_customer_activity(p_customer, 'PANEL_CREDENTIALS_SET', format('Panel password set for %s and e-mailed to the customer', v_name));
  -- which service - never the password
  perform private.write_audit('SERVICE_PANEL_CREDENTIALS_SET', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('service', p_service));
  return jsonb_build_object('queued', true, 'replayed', false);
end $$;
revoke all on function public.panel_credentials_send(uuid, text, text, uuid) from public, anon;
grant execute on function public.panel_credentials_send(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. A credential waiting for a RETRY is kept (it is erased the moment the job is sent, skipped or failed, and after 7 days at most)
--    The provisioning migration erased it on every finish, so a provider hiccup (HTTP 503) would have lost the password the next attempt needs.
--    Same function as before in every other respect (the staff notifications for failed account and payment e-mails included).
-- ---------------------------------------------------------------------------
create or replace function public.automation_finish_job(p_job uuid, p_outcome text, p_detail text DEFAULT NULL::text, p_response_code integer DEFAULT NULL::integer, p_recipient text DEFAULT NULL::text, p_provider_ref text DEFAULT NULL::text)
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
         -- a waiting retry still needs the encrypted credential to be able to send; anything that ends the job erases it
         secret = case when v_status = 'QUEUED' then secret else null end
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

notify pgrst, 'reload schema';
