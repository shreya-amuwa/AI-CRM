-- Client Panel URL (Meta Verifier -> Client login details).
--
-- The address where the customer signs in to the panel of ONE service. It is recorded per customer AND service (customer_services.panel_url),
-- next to the account / user ID that already lives there, so a customer with two WhatsApp services can have two panels.
--
--   * Validated in the database as well as on the page and in the API: HTTPS only, a real host name (no IP address, localhost or internal name),
--     no "user:password@" part, no whitespace, at most 500 characters, and nothing that looks like a password or token anywhere in the link.
--   * The same access rule as the other panel details (the route's Meta Verifier / Technical Consultant, the Department Head of the
--     customer's department, the Super Admin). Every change is audited (service + host, never the full link) and written to the activity.
--   * Saving a URL sends nothing. Sending is a deliberate action ("E-mail the panel link"), on the existing e-mail workflow (one automation job):
--       - the same link to the same customer and service is sent once; a double click, a retry or a repeated request is a no-op;
--       - CHANGING the link makes it sendable again (the new address is a different link) and the section says "changed since it was sent";
--       - the same link can be sent again on purpose ("Send again"), once per click;
--       - a link whose e-mail failed or was skipped can simply be sent again.
--   * The customer's "Status Completed" e-mail and WhatsApp use the customer's own panel URL when there is one (otherwise the department's).
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Where it is kept
-- ---------------------------------------------------------------------------
alter table public.customer_services add column if not exists panel_url text;
alter table public.customer_services drop constraint if exists customer_services_panel_url_check;
alter table public.customer_services add constraint customer_services_panel_url_check
  check (panel_url is null or (length(panel_url) <= 500 and panel_url ~ '^https://[^\s@/?#]+([/?#][^\s]*)?$'));

-- The link last queued for a customer's service: which address, who and when, and the e-mail job that carried it (for its state).
create table if not exists public.service_panel_links (
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code) on delete restrict,
  url text not null,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles (id) on delete set null,
  last_job uuid references public.automation_jobs (id) on delete set null,
  primary key (customer_id, service_code)
);
alter table public.service_panel_links enable row level security;
revoke all on public.service_panel_links from public, anon, authenticated;

alter table public.automation_jobs drop constraint if exists automation_jobs_stage_check;
alter table public.automation_jobs add constraint automation_jobs_stage_check
  check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED', 'WEBSITE_READY', 'ACCOUNTS_PAYMENT', 'ACCOUNT_CREATED', 'PANEL_CREDENTIALS', 'PANEL_LINK'));

-- ---------------------------------------------------------------------------
-- 2. The rules of a panel URL (the page and the API apply the same ones, shared/panelUrl.ts)
-- ---------------------------------------------------------------------------
create or replace function private.clean_panel_url(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := btrim(coalesce(p, ''));
  v_rest text;
  v_auth text;
  v_tail text;
begin
  if v = '' then return null; end if;
  if length(v) > 500 then
    raise exception 'VALIDATION_ERROR: The panel URL is too long (500 characters at most).' using errcode = 'P0001';
  end if;
  if v ~ '[[:space:][:cntrl:]]' then
    raise exception 'VALIDATION_ERROR: The panel URL cannot contain spaces.' using errcode = 'P0001';
  end if;
  if v !~* '^https://' then
    raise exception 'VALIDATION_ERROR: The panel URL must start with https:// (a secure link).' using errcode = 'P0001';
  end if;
  v_rest := substr(v, 9);
  v_auth := lower(substring(v_rest from '^[^/?#]*'));
  v_tail := substr(v_rest, length(v_auth) + 1);
  if v_auth like '%@%' then
    raise exception 'VALIDATION_ERROR: The panel URL cannot contain a user name or password.' using errcode = 'P0001';
  end if;
  if v_auth !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$'
     or regexp_replace(v_auth, ':[0-9]+$', '') ~ '^[0-9.]+$'
     or regexp_replace(v_auth, ':[0-9]+$', '') ~ '\.(local|localhost|internal|lan|home|test|invalid|example)$' then
    raise exception 'VALIDATION_ERROR: Enter a public web address such as https://panel.example.com/login.' using errcode = 'P0001';
  end if;
  if v_tail ~* '(passw|pwd|secret|token|api[_-]?key|[?&;]key=|auth|session|otp|signature|[?&]sig=|credential|jwt|bearer)' then
    raise exception 'VALIDATION_ERROR: The panel URL must not carry a password, key or token. Enter the plain sign-in address.' using errcode = 'P0001';
  end if;
  return 'https://' || v_auth || v_tail;
end $$;
revoke all on function private.clean_panel_url(text) from public, anon, authenticated;
grant execute on function private.clean_panel_url(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Record or clear the panel URL of one service (sends nothing)
-- ---------------------------------------------------------------------------
create or replace function public.panel_url_set(p_customer uuid, p_service text, p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_url text := private.clean_panel_url(p_url);
  v_old text;
  v_name text;
  v_host text;
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select cs.panel_url into v_old from public.customer_services cs
   where cs.customer_id = p_customer and cs.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = cs.service_code and s.requires_meta_verification)
   for update;
  if not found then
    raise exception 'NOT_FOUND: That is not a WhatsApp service of this customer.' using errcode = 'P0001';
  end if;
  if v_url is not distinct from v_old then
    return jsonb_build_object('changed', false, 'panelUrl', v_url);  -- nothing changed: no write, no history
  end if;
  update public.customer_services set panel_url = v_url where customer_id = p_customer and service_code = p_service;
  select name into v_name from public.crm_services where code = p_service;
  v_host := substring(coalesce(v_url, '') from '^https://([^/?#]*)');
  perform private.log_customer_activity(p_customer, 'PANEL_URL_SAVED',
    format('Client panel URL %s for %s', case when v_url is null then 'removed' when v_old is null then 'saved' else 'changed' end, v_name));
  -- which service and which host - never the full link
  perform private.write_audit('SERVICE_PANEL_URL_SET', 'customer', p_customer,
    (select department_id from public.customers where id = p_customer), (select team_id from public.customers where id = p_customer),
    jsonb_build_object('service', p_service, 'host', v_host, 'cleared', v_url is null, 'replaced', v_old is not null));
  return jsonb_build_object('changed', true, 'panelUrl', v_url);
end $$;
revoke all on function public.panel_url_set(uuid, text, text) from public, anon;
grant execute on function public.panel_url_set(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. E-mail the panel link to the customer (one automation job; a repeated or duplicate request sends nothing more)
-- ---------------------------------------------------------------------------
create or replace function public.panel_link_send(p_customer uuid, p_service text, p_request uuid, p_resend boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  cs public.customer_services;
  v_name text;
  v_email text;
  v_key text;
  v_prev text;
  v_job uuid;
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_request is null then
    raise exception 'VALIDATION_ERROR: The request id is missing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into cs from public.customer_services x
   where x.customer_id = p_customer and x.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = x.service_code and s.requires_meta_verification) for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: That is not a WhatsApp service of this customer.' using errcode = 'P0001';
  end if;
  if cs.panel_url is null then
    raise exception 'VALIDATION_ERROR: Save the panel URL first.' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(v.email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: The customer has no valid e-mail address on the record. Ask Accounts to correct it, then send the panel link.' using errcode = 'P0001';
  end if;
  select name into v_name from public.crm_services where code = p_service;

  -- the same link for the same customer and service is one e-mail; a failed or skipped one may be sent again, a sent one only on purpose
  v_key := format('PANELLINK|%s|%s|%s', p_customer, p_service, md5(cs.panel_url));
  select j.status into v_prev from public.automation_jobs j where j.dedupe_key = v_key;
  if v_prev in ('QUEUED', 'SENDING') or (v_prev = 'SENT' and not coalesce(p_resend, false)) then
    return jsonb_build_object('queued', false, 'replayed', true, 'reason', case when v_prev = 'SENT' then 'ALREADY_SENT' else 'IN_PROGRESS' end);
  end if;
  if v_prev is not null then
    v_key := v_key || '|' || p_request::text;
  end if;
  insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, created_by)
  values (p_customer, 'EMAIL', 'PANEL_LINK', v_key,
          jsonb_strip_nulls(jsonb_build_object('service', p_service, 'serviceName', v_name, 'panel', cs.platform, 'panelUrl', cs.panel_url)),
          (select private.my_id()))
  on conflict (dedupe_key) do nothing
  returning id into v_job;
  if v_job is null then
    return jsonb_build_object('queued', false, 'replayed', true, 'reason', 'REPEATED_REQUEST');
  end if;
  insert into public.service_panel_links (customer_id, service_code, url, sent_at, sent_by, last_job)
  values (p_customer, p_service, cs.panel_url, now(), (select private.my_id()), v_job)
  on conflict (customer_id, service_code) do update set url = excluded.url, sent_at = now(), sent_by = excluded.sent_by, last_job = excluded.last_job;
  perform private.log_customer_activity(p_customer, 'PANEL_LINK_SENT', format('Panel link for %s e-mailed to the customer', v_name));
  perform private.write_audit('SERVICE_PANEL_LINK_SENT', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('service', p_service, 'resend', coalesce(p_resend, false)));
  return jsonb_build_object('queued', true, 'replayed', false);
end $$;
revoke all on function public.panel_link_send(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.panel_link_send(uuid, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What the section shows: the panel URL, and where its e-mail stands (same as before in every other respect)
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
                 'panelUrl', cs.panel_url,
                 -- the link e-mail: which address went out, when, and whether the saved URL is still that one
                 'link', (select jsonb_build_object('sentAt', l.sent_at, 'sentBy', (select full_name from public.profiles where id = l.sent_by),
                                   'current', l.url = cs.panel_url,
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = l.last_job))
                            from public.service_panel_links l where l.customer_id = cs.customer_id and l.service_code = cs.service_code),
                 -- whether a password was set for the customer and what happened to the e-mail that carried it (never the password itself)
                 'credentials', (select jsonb_build_object('setAt', pc.set_at, 'setBy', (select full_name from public.profiles where id = pc.set_by),
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = pc.last_job))
                                   from public.service_panel_credentials pc where pc.customer_id = cs.customer_id and pc.service_code = cs.service_code)) order by s.sort_order, s.code)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = p_customer and s.requires_meta_verification), '[]'::jsonb),
    -- the address the panel password and link are e-mailed to: the one on the customer record
    'customerEmail', (select nullif(btrim(c.email), '') from public.customers c where c.id = p_customer),
    'dashboardLogin', (select jsonb_build_object('email', a.email, 'createdAt', a.created_at) from public.customer_client_accounts a where a.customer_id = p_customer));
end $$;
revoke all on function public.panel_details_list(uuid) from public, anon;
grant execute on function public.panel_details_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The dispatcher gets the customer's panel URL with the job (same function as before, plus 'panelUrl')
-- ---------------------------------------------------------------------------
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
        'panelUrl', (select cs.panel_url from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                      where cs.customer_id = c.id and cs.panel_url is not null order by s.sort_order, s.code limit 1),
        'loginEmail', (select a.email from public.customer_client_accounts a where a.customer_id = c.id)))
      order by j.next_attempt_at)
      from public.automation_jobs j
      join public.customers c on c.id = j.customer_id
      join public.departments d on d.id = c.department_id
     where j.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.automation_claim_jobs(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.automation_claim_jobs(text[], integer, integer) to service_role;

notify pgrst, 'reload schema';
