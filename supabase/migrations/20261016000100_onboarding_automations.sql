-- =============================================================================
-- Onboarding email + WhatsApp automations, driven by the CRM database
-- (replaces the Google Sheet + Apps Script trigger for these customers).
--
-- Scope (for now): Wabastore customers with the "WhatsApp API + Blue Tick" service.
-- Everything happens from the Technical Consultant's work:
--
--   customer reaches the TC (Accounts confirmed the payment):
--       website URL entered by sales  -> UNDER_REVIEW      ("Documents Received - Under Review")
--       "no website" ticked / empty   -> WEBSITE_PENDING   ("Mini Website for Your Business")
--   TC has the website link saved and every item authorized
--                                     -> META_VERIFICATION ("Meta Verification In Progress", 2-3 weeks)
--   TC creates the client login       -> COMPLETED         ("Meta Verification Completed - Panel Access Details")
--
-- The stage only moves forward and every stage is messaged at most once per channel:
-- a unique dedupe key per (customer, channel, stage) replaces the sheet's
-- "Last Email Sent" / "Last WhatsApp Sent" / "WhatsApp Event Key" columns.
--
-- The database decides WHEN (triggers write jobs into automation_jobs in the same
-- transaction as the change); the API server decides HOW (it claims due jobs,
-- sends, and records the result). Triggers never call a provider.
--
-- Additive / re-runnable. Existing customers get their current stage recorded
-- WITHOUT any message, so going live sends nothing for work that already happened.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The client stage (the sheet's "Email Status")
-- ---------------------------------------------------------------------------
alter table public.customer_onboarding
  add column if not exists client_status text,
  add column if not exists client_status_changed_at timestamptz;
do $$
begin
  alter table public.customer_onboarding add constraint customer_onboarding_client_status_check
    check (client_status in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED'));
exception when duplicate_object then null;
end $$;

-- Order of the stages (forward only). Website Pending and Under Review are both "start" stages.
create or replace function private.client_status_rank(p_status text)
returns integer language sql immutable set search_path = '' as $$
  select case p_status when 'WEBSITE_PENDING' then 0 when 'UNDER_REVIEW' then 1
                       when 'META_VERIFICATION' then 2 when 'COMPLETED' then 3 else -1 end
$$;
revoke all on function private.client_status_rank(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Website: a URL, or "no website" (ticked by sales). Same item as before.
-- ---------------------------------------------------------------------------
update public.onboarding_items
   set hint = 'The business website. Tick "Customer has no website" if they do not have one.'
 where code = 'WA_WEBSITE_URL';

create or replace function private.tg_onboarding_entries_website()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v text;
begin
  if new.item_code <> 'WA_WEBSITE_URL' or new.value is null then
    return new;
  end if;
  v := btrim(new.value);
  if upper(v) in ('NO_WEBSITE', 'NO WEBSITE') then
    new.value := 'NO_WEBSITE';
    return new;
  end if;
  if v !~* '^https?://' then
    v := 'https://' || v;
  end if;
  if length(v) > 500 or v !~* '^https?://[^\s/?#]+\.[^\s/?#]{2,}(\S*)$' then
    raise exception 'VALIDATION_ERROR: Enter the website address (for example https://example.com), or tick "Customer has no website".' using errcode = 'P0001';
  end if;
  new.value := v;
  return new;
end $$;
revoke all on function private.tg_onboarding_entries_website() from public, anon, authenticated;
drop trigger if exists onboarding_entries_website on public.customer_onboarding_entries;
create trigger onboarding_entries_website before insert or update of value on public.customer_onboarding_entries
  for each row execute function private.tg_onboarding_entries_website();

-- The customer's website as the automation sees it: a URL, 'NO_WEBSITE', or null (not filled in).
create or replace function private.customer_website(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select e.value from public.customer_onboarding_entries e
   where e.customer_id = p_customer and e.item_code = 'WA_WEBSITE_URL'
$$;
revoke all on function private.customer_website(uuid) from public, anon, authenticated;

-- The Technical Consultant saves (or corrects) the website link. It counts as authorized.
create or replace function public.consultant_set_website(p_customer uuid, p_url text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  e public.customer_onboarding_entries;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.onboarding_item_services m
                   join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
                  where m.item_code = 'WA_WEBSITE_URL') then
    raise exception 'VALIDATION_ERROR: This customer''s services have no website item.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_url, '')), '') is null or upper(btrim(p_url)) in ('NO_WEBSITE', 'NO WEBSITE') then
    raise exception 'VALIDATION_ERROR: Enter the website address (for example https://example.com).' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  insert into public.customer_onboarding_entries as x (customer_id, item_code, value, status, saved_by, saved_at, reviewed_by, reviewed_at)
  values (p_customer, 'WA_WEBSITE_URL', p_url, 'VERIFIED', (select private.my_id()), now(), (select private.my_id()), now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, status = 'VERIFIED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = excluded.reviewed_by, reviewed_at = now(), review_note = null
  returning * into e;
  perform private.refresh_onboarding_progress(p_customer);
  perform private.log_customer_activity(p_customer, 'WEBSITE_SAVED', format('Website saved by the Technical Consultant: %s', e.value));
  perform private.write_audit('ONBOARDING_WEBSITE_SAVED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('website', e.value));
  return e.value;
end $$;
revoke all on function public.consultant_set_website(uuid, text) from public, anon;
grant execute on function public.consultant_set_website(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Outbox: one row per message to send (email or WhatsApp)
-- ---------------------------------------------------------------------------
create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  channel text not null check (channel in ('EMAIL', 'WHATSAPP')),
  stage text not null check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED')),
  -- ONBOARD|<customer>|<channel>|<stage>: a stage is messaged at most once per channel
  dedupe_key text not null unique,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED')),
  detail text check (length(detail) <= 500),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  recipient text check (length(recipient) <= 254),
  response_code integer,
  provider_ref text check (length(provider_ref) <= 200),
  -- COMPLETED email only: the client password, encrypted by the API server (AES-256-GCM),
  -- kept only until the email is sent or given up. Never readable by any signed-in user.
  secret text check (length(secret) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists automation_jobs_customer_idx on public.automation_jobs (customer_id, created_at desc);
create index if not exists automation_jobs_due_idx on public.automation_jobs (next_attempt_at) where status in ('QUEUED', 'SENDING');

drop trigger if exists automation_jobs_set_updated_at on public.automation_jobs;
create trigger automation_jobs_set_updated_at before update on public.automation_jobs
  for each row execute function public.tg_set_updated_at();

alter table public.automation_jobs enable row level security;
revoke all on public.automation_jobs from public, anon, authenticated;
-- Every column except the encrypted password; nobody signed in can write.
grant select (id, customer_id, channel, stage, dedupe_key, status, detail, context, attempts, next_attempt_at,
              recipient, response_code, created_at, sent_at, updated_at) on public.automation_jobs to authenticated;
drop policy if exists automation_jobs_select on public.automation_jobs;
create policy automation_jobs_select on public.automation_jobs for select to authenticated
  using (private.can_view_onboarding_review(customer_id) or private.can_view_customer(customer_id));

-- What the customer page shows: is the customer automated, and at which stage.
create or replace function public.customer_client_stage(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
begin
  if not (private.can_view_onboarding_review(p_customer) or private.can_view_customer(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  return jsonb_build_object('automated', private.automation_eligible(p_customer),
                            'stage', o.client_status, 'stageChangedAt', o.client_status_changed_at);
end $$;
revoke all on function public.customer_client_stage(uuid) from public, anon;
grant execute on function public.customer_client_stage(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.automation_jobs;
exception when duplicate_object or undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Which customers are automated (for now: Wabastore + WhatsApp API + Blue Tick)
-- ---------------------------------------------------------------------------
create or replace function private.automation_eligible(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
      join public.departments d on d.id = c.department_id
     where c.id = p_customer
       and d.slug = 'wabastore'
       and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
       and exists (select 1 from public.customer_services cs
                    where cs.customer_id = c.id and cs.service_code = 'WHATSAPP_API_BLUE_TICK'))
$$;
revoke all on function private.automation_eligible(uuid) from public, anon, authenticated;

-- The stage the customer's data says they have reached (no history needed).
create or replace function private.client_status_target(p_customer uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  v_site text := private.customer_website(p_customer);
  v_has_site boolean;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if o.customer_id is null or o.forwarded_to_support_at is null then
    return null; -- not in the Technical Consultant's dashboard yet
  end if;
  v_has_site := v_site is not null and v_site <> 'NO_WEBSITE';
  if exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer) then
    return 'COMPLETED';
  end if;
  -- every document / detail sales collected is authorized (the WABA ID comes later, at completion)
  if o.returned_at is null and o.items_total > 0 and o.items_verified >= o.items_total and o.items_rejected = 0 and v_has_site then
    return 'META_VERIFICATION';
  end if;
  return case when v_has_site then 'UNDER_REVIEW' else 'WEBSITE_PENDING' end;
end $$;
revoke all on function private.client_status_target(uuid) from public, anon, authenticated;

-- Move the stage forward (never back) and queue one email + one WhatsApp for the new stage.
-- p_silent: record the stage without messages (used once for customers that existed before).
create or replace function private.advance_client_status(p_customer uuid, p_silent boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  v_target text;
  v_from text;
  v_secret text := nullif(current_setting('crm.automation_secret', true), '');
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
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, secret, created_by)
    values (p_customer, ch, v_target, format('ONBOARD|%s|%s|%s', p_customer, ch, v_target),
            jsonb_strip_nulls(jsonb_build_object('from', v_from)),
            case when ch = 'EMAIL' and v_target = 'COMPLETED' then v_secret end,
            (select private.my_id()))
    on conflict (dedupe_key) do nothing;
  end loop;
  perform private.log_customer_activity(p_customer, 'CLIENT_STATUS_CHANGED',
    format('Client status: %s - email and WhatsApp queued', initcap(replace(v_target, '_', ' '))));
  perform private.write_audit('CLIENT_STATUS_CHANGED', 'customer', p_customer,
    (select department_id from public.customers where id = p_customer), (select team_id from public.customers where id = p_customer),
    jsonb_build_object('from', v_from, 'to', v_target));
  return v_target;
end $$;
revoke all on function private.advance_client_status(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Triggers: every path that changes the data (API, RPC, SQL editor) is covered
-- ---------------------------------------------------------------------------
create or replace function private.tg_client_status_from_onboarding()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.advance_client_status(new.customer_id);
  return null;
end $$;
revoke all on function private.tg_client_status_from_onboarding() from public, anon, authenticated;
drop trigger if exists customer_onboarding_client_status on public.customer_onboarding;
-- Not for the update that writes the stage itself (advance_client_status), so it never loops.
create trigger customer_onboarding_client_status after update on public.customer_onboarding
  for each row when (old.client_status is not distinct from new.client_status)
  execute function private.tg_client_status_from_onboarding();

create or replace function private.tg_client_status_from_customer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.advance_client_status(coalesce(new.customer_id, old.customer_id));
  return null;
end $$;
revoke all on function private.tg_client_status_from_customer() from public, anon, authenticated;

drop trigger if exists customer_client_accounts_client_status on public.customer_client_accounts;
create trigger customer_client_accounts_client_status after insert on public.customer_client_accounts
  for each row execute function private.tg_client_status_from_customer();

drop trigger if exists onboarding_entries_client_status on public.customer_onboarding_entries;
create trigger onboarding_entries_client_status after insert or update on public.customer_onboarding_entries
  for each row when (new.item_code = 'WA_WEBSITE_URL')
  execute function private.tg_client_status_from_customer();

-- ---------------------------------------------------------------------------
-- 6. Client login: step 3. The password reaches the completion email once.
-- ---------------------------------------------------------------------------
-- For automated customers the login is created after the Meta Verification step
-- (website saved + every item authorized), so the email order is always right.
create or replace function public.assert_client_account_allowed(p_customer uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not private.may_manage_client_account(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer already has a login.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) or exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'CONFLICT: That e-mail already has a login. Use a different e-mail for the client.' using errcode = 'P0001';
  end if;
  if private.automation_eligible(p_customer)
     and coalesce((select o.client_status from public.customer_onboarding o where o.customer_id = p_customer), '') <> 'META_VERIFICATION' then
    raise exception 'VALIDATION_ERROR: Save the customer''s website link and authorize every document first. The client login is the last step (it sends the panel access email).' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.assert_client_account_allowed(uuid, text) from public, anon;
grant execute on function public.assert_client_account_allowed(uuid, text) to authenticated;

-- p_secret: the password encrypted by the API server, for the completion email only.
drop function if exists public.record_client_account(uuid, uuid, text);
create or replace function public.record_client_account(p_customer uuid, p_user_id uuid, p_email text, p_secret text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not private.may_manage_client_account(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u
                  where u.id = p_user_id and lower(u.email) = v_email
                    and u.raw_app_meta_data ->> 'client_customer_id' = p_customer::text) then
    raise exception 'VALIDATION_ERROR: The client login was not created for this customer.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_secret, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Invalid request.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  -- visible only inside this transaction, to the trigger that queues the completion email
  perform set_config('crm.automation_secret', coalesce(p_secret, ''), true);
  insert into public.customer_client_accounts (customer_id, auth_user_id, email, created_by)
  values (p_customer, p_user_id, v_email, (select private.my_id()));
  perform set_config('crm.automation_secret', '', true);
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_CREATED', format('Client login created (%s)', v_email));
  perform private.write_audit('CLIENT_LOGIN_CREATED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('email', v_email));
end $$;
revoke all on function public.record_client_account(uuid, uuid, text, text) from public, anon;
grant execute on function public.record_client_account(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Sending (API server, service role only)
-- ---------------------------------------------------------------------------
-- Claims due jobs. FOR UPDATE SKIP LOCKED: two dispatcher runs never take the same job.
-- A job left in SENDING (server crashed mid-send) is taken again once its lease expires.
create or replace function public.automation_claim_jobs(p_channels text[], p_limit integer default 10, p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  -- an encrypted password is never kept longer than 7 days, sent or not
  update public.automation_jobs set secret = null where secret is not null and created_at < now() - interval '7 days';
  select coalesce(array_agg(id), '{}') into v_ids from (
    select j.id from public.automation_jobs j
     where j.channel = any (coalesce(p_channels, '{}'))
       and ((j.status = 'QUEUED' and j.next_attempt_at <= now())
         or (j.status = 'SENDING' and j.locked_until < now()))
     order by j.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;

  update public.automation_jobs
     set status = 'SENDING', attempts = attempts + 1,
         locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 1800)))
   where id = any (v_ids);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', j.id, 'channel', j.channel, 'stage', j.stage, 'attempts', j.attempts, 'context', j.context, 'secret', j.secret,
      'customer', jsonb_build_object(
        'id', c.id, 'name', c.name, 'company', c.company, 'email', c.email,
        'whatsapp', coalesce(nullif(btrim(c.whatsapp), ''), c.phone),
        'departmentSlug', d.slug, 'department', d.name,
        'website', private.customer_website(c.id),
        'loginEmail', (select a.email from public.customer_client_accounts a where a.customer_id = c.id)))
      order by j.next_attempt_at)
      from public.automation_jobs j
      join public.customers c on c.id = j.customer_id
      join public.departments d on d.id = c.department_id
     where j.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.automation_claim_jobs(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.automation_claim_jobs(text[], integer, integer) to service_role;

-- Records the result. RETRY waits 1, 5, 15, 60 minutes; after 5 attempts the job FAILED.
-- A finished job forgets its encrypted password.
create or replace function public.automation_finish_job(
  p_job uuid, p_outcome text, p_detail text default null, p_response_code integer default null,
  p_recipient text default null, p_provider_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
         secret = case when v_status = 'QUEUED' then secret end
   where id = p_job
  returning * into j;

  if v_status in ('SENT', 'FAILED', 'SKIPPED') then
    select * into v from public.customers where id = j.customer_id;
    perform private.log_customer_activity(j.customer_id, 'AUTOMATION_' || j.channel || '_' || v_status,
      format('%s %s: %s%s', initcap(replace(j.stage, '_', ' ')), case when j.channel = 'EMAIL' then 'email' else 'WhatsApp' end,
             lower(v_status), case when p_detail is not null and v_status <> 'SENT' then ' - ' || left(p_detail, 200) else '' end));
    if v_status = 'FAILED' then
      perform private.write_audit('AUTOMATION_FAILED', 'customer', j.customer_id, v.department_id, v.team_id,
        jsonb_build_object('job', j.id, 'channel', j.channel, 'stage', j.stage, 'detail', left(p_detail, 200)));
      for v_recipient in
        select p.id from public.profiles p join public.teams t on t.id = p.team_id
         where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
           and (p.is_technical_consultant or p.role = 'TEAM_HEAD')
      loop
        perform private.notify(v_recipient, 'AUTOMATION_FAILED',
          format('%s not sent: %s', case when j.channel = 'EMAIL' then 'Email' else 'WhatsApp' end, coalesce(v.company, v.name)),
          format('The %s message could not be sent after %s attempts: %s', initcap(replace(j.stage, '_', ' ')), j.attempts, coalesce(left(p_detail, 300), 'unknown error')),
          'customer', j.customer_id, '{}'::jsonb, 'urgent');
      end loop;
    end if;
  end if;
  return jsonb_build_object('id', j.id, 'status', j.status, 'attempts', j.attempts, 'nextAttemptAt', j.next_attempt_at);
end $$;
revoke all on function public.automation_finish_job(uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.automation_finish_job(uuid, text, text, integer, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Existing customers: record where they are, send nothing
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select o.customer_id from public.customer_onboarding o
            where o.client_status is null and o.forwarded_to_support_at is not null
  loop
    perform private.advance_client_status(r.customer_id, true);
  end loop;
end $$;
