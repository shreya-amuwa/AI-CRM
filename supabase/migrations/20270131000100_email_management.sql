-- =============================================================================
-- Email management: provider routing state and quotas, sender addresses, automatic CC / BCC rules, one log of every e-mail the CRM,
-- the Candidate Portal and the Client Portal send, provider events (Resend webhooks), and one suppression list for every provider
-- (docs/EMAIL_MANAGEMENT.md).
-- Run after 20270130000100_unified_head_sales_pages.sql. Additive and safe to run twice; pasteable in the Supabase SQL editor.
--
-- What it does NOT replace: each e-mail family keeps its own durable queue (automation_jobs, welcome / HR / finance e-mail events,
-- recruitment_decision_emails, the meetings outbox, invoice sending). Those queues already claim with leases and retry with backoff.
-- This adds what was missing ACROSS them, at the moment of sending (email_send_begin / email_send_finish, called by
-- server/automations/providers.ts):
--   * an idempotency key per business event: a second send of the same event is answered "already accepted" instead of e-mailing again;
--   * which provider took each e-mail, every attempt, and what the provider later reported (delivered, bounced, complained);
--   * one suppression list: a hard bounce or complaint reported by Resend blocks the address for SES and SMTP too;
--   * shared provider state (a quota pause seen by one Worker instance is seen by all) and usage counting with a reserve for CRITICAL e-mail;
--   * the sender address of each category and the CC / BCC recipients, resolved now from the live assignments (an employee who left,
--     was suspended or lost the assignment is never resolved);
--   * NO copies, ever, of authentication / credential e-mails (AUTH, CREDENTIALS): enforced here and in providers.ts.
-- Nothing secret is stored: no message body, no link, no code, no password, no API key. Authentication e-mails keep only a masked address.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings (one row), senders, rules
-- ---------------------------------------------------------------------------
create table if not exists public.email_settings (
  id boolean primary key default true check (id),
  provider_order text[],                                    -- null = the deployment's EMAIL_PROVIDER_ORDER / EMAIL_PROVIDER
  quota_thresholds integer[] not null default '{70,85,95,100}',
  resend_daily_limit integer not null default 100 check (resend_daily_limit between 0 and 10000000),
  resend_monthly_limit integer not null default 3000 check (resend_monthly_limit between 0 and 100000000),
  ses_daily_limit integer check (ses_daily_limit is null or ses_daily_limit between 0 and 100000000),
  critical_reserve integer not null default 10 check (critical_reserve between 0 and 10000),
  max_auto_recipients integer not null default 5 check (max_auto_recipients between 0 and 20),
  allowed_sender_domains text[] not null default '{amuwa.com}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_settings_order_check') then
    alter table public.email_settings add constraint email_settings_order_check
      check (provider_order is null or (cardinality(provider_order) between 1 and 3 and provider_order <@ '{resend,ses,smtp}'::text[]));
  end if;
end $$;
insert into public.email_settings (id) values (true) on conflict (id) do nothing;
alter table public.email_settings enable row level security;
revoke all on public.email_settings from public, anon, authenticated;

-- The e-mail categories. AUTH and CREDENTIALS are sensitive: they carry a one-time link, a code or a password, and never get a copy.
create or replace function private.email_category_ok(p text) returns boolean language sql immutable set search_path = '' as $$
  select p in ('AUTH', 'CREDENTIALS', 'RECRUITMENT', 'INTERVIEW', 'HR', 'CLIENT_ONBOARDING', 'META_VERIFICATION', 'TECHNICAL', 'ACCOUNTS',
               'INVOICE', 'PAYMENT', 'RENEWAL', 'MEETING', 'SUPPORT', 'SALES', 'GENERAL')
$$;
create or replace function private.email_category_sensitive(p text) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p in ('AUTH', 'CREDENTIALS'), true)
$$;
revoke all on function private.email_category_ok(text) from public, anon, authenticated;
revoke all on function private.email_category_sensitive(text) from public, anon, authenticated;

create table if not exists public.email_senders (
  category text primary key check (private.email_category_ok(category)),
  from_email text not null check (from_email = lower(from_email) and from_email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
  from_name text not null check (length(btrim(from_name)) between 1 and 80 and from_name !~ '[<>"\r\n]'),
  reply_to text check (reply_to is null or (reply_to = lower(reply_to) and reply_to ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.email_senders enable row level security;
revoke all on public.email_senders from public, anon, authenticated;

-- Automatic CC / BCC. target: who is copied.
--   assigned roles, resolved from the e-mail's own record at send time: CUSTOMER_OWNER (customers.owner_id), RELATIONSHIP_MANAGER
--   (private.rm_of), META_VERIFIER (customer_onboarding.meta_verifier_id), ACCOUNTS_OWNER (customers.accounts_owner_id),
--   TECHNICAL_CONSULTANT (customer_onboarding.consultant_started_by), RECRUITER (the vacancy's responsible recruiter);
--   PROFILE: named employees (still only while ACTIVE); ADDRESS: company mailboxes on an allowed sender domain.
create table if not exists public.email_recipient_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  category text not null check (private.email_category_ok(category) and not private.email_category_sensitive(category)),
  application text check (application is null or application in ('CRM', 'CANDIDATE_PORTAL', 'CLIENT_PORTAL')),
  department_id uuid references public.departments (id) on delete cascade,
  workflow text check (workflow is null or length(workflow) <= 60),
  mode text not null check (mode in ('CC', 'BCC')),
  target text not null check (target in ('CUSTOMER_OWNER', 'RELATIONSHIP_MANAGER', 'META_VERIFIER', 'ACCOUNTS_OWNER', 'TECHNICAL_CONSULTANT',
                                          'RECRUITER', 'PROFILE', 'ADDRESS')),
  profile_ids uuid[] not null default '{}',
  addresses text[] not null default '{}',
  exclude_profile_ids uuid[] not null default '{}',
  priority integer not null default 100 check (priority between 1 and 1000),
  enabled boolean not null default false,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check (target <> 'PROFILE' or cardinality(profile_ids) between 1 and 20),
  check (target <> 'ADDRESS' or cardinality(addresses) between 1 and 20)
);
create index if not exists email_recipient_rules_category_idx on public.email_recipient_rules (category) where enabled;
alter table public.email_recipient_rules enable row level security;
revoke all on public.email_recipient_rules from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The log, attempts, provider events, suppression, provider state, usage
-- ---------------------------------------------------------------------------
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique check (idempotency_key is null or length(idempotency_key) between 8 and 200),
  application text not null default 'CRM' check (application in ('CRM', 'CANDIDATE_PORTAL', 'CLIENT_PORTAL')),
  category text not null default 'GENERAL' check (private.email_category_ok(category)),
  template text check (template is null or length(template) <= 80),
  priority text not null default 'NORMAL' check (priority in ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
  sender text check (sender is null or length(sender) <= 200),
  recipient text not null check (length(recipient) <= 320),        -- masked for AUTH / CREDENTIALS
  cc text[] not null default '{}',
  bcc_count integer not null default 0,
  bcc text[] not null default '{}',                                  -- Super Admin only, never in ordinary answers
  recipient_count integer not null default 1,
  customer_id uuid references public.customers (id) on delete set null,
  application_id uuid references public.career_applications (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  status text not null default 'PROCESSING'
    check (status in ('QUEUED', 'PROCESSING', 'ACCEPTED', 'DELIVERY_CONFIRMED', 'DEFERRED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'RETRY_PENDING',
                      'UNKNOWN_ACCEPTANCE', 'CANCELLED', 'EXPIRED', 'SUPPRESSED')),
  provider text check (provider is null or provider in ('resend', 'ses', 'smtp', 'brevo')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 300),
  planned_provider text,
  fallback_used boolean not null default false,
  attempts integer not null default 0,
  error_category text check (error_category is null or length(error_category) <= 40),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists email_messages_created_idx on public.email_messages (created_at desc);
create index if not exists email_messages_status_idx on public.email_messages (status, created_at desc);
create index if not exists email_messages_customer_idx on public.email_messages (customer_id, created_at desc) where customer_id is not null;
create index if not exists email_messages_application_idx on public.email_messages (application_id, created_at desc) where application_id is not null;
create index if not exists email_messages_provider_ref_idx on public.email_messages (provider, provider_message_id) where provider_message_id is not null;
create index if not exists email_messages_category_idx on public.email_messages (category, created_at desc);
alter table public.email_messages enable row level security;
revoke all on public.email_messages from public, anon, authenticated;

create table if not exists public.email_attempts (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.email_messages (id) on delete cascade,
  provider text not null check (provider in ('resend', 'ses', 'smtp', 'brevo')),
  outcome text not null check (outcome in ('ACCEPTED', 'REJECTED', 'RETRYABLE', 'UNKNOWN_ACCEPTANCE', 'SKIPPED')),
  error_category text check (error_category is null or length(error_category) <= 40),
  status_code integer,
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 300),
  duration_ms integer,
  attempted_at timestamptz not null default now()
);
create index if not exists email_attempts_message_idx on public.email_attempts (message_id);
create index if not exists email_attempts_time_idx on public.email_attempts (attempted_at);
alter table public.email_attempts enable row level security;
revoke all on public.email_attempts from public, anon, authenticated;

create table if not exists public.email_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('resend', 'ses')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  event_type text not null check (length(event_type) <= 60),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 300),
  message_id uuid references public.email_messages (id) on delete set null,
  bounce_type text check (bounce_type is null or length(bounce_type) <= 40),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index if not exists email_events_message_idx on public.email_events (message_id);
alter table public.email_events enable row level security;
revoke all on public.email_events from public, anon, authenticated;

create table if not exists public.email_suppressions (
  email text primary key check (email = lower(email) and length(email) <= 320),
  active boolean not null default true,
  reason text not null check (reason in ('HARD_BOUNCE', 'COMPLAINT', 'MANUAL', 'PROVIDER_SUPPRESSED')),
  source text not null check (source in ('resend', 'ses', 'smtp', 'admin')),
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from public, anon, authenticated;

create table if not exists public.email_provider_state (
  provider text primary key check (provider in ('resend', 'ses', 'smtp', 'brevo')),
  paused_until timestamptz,
  pause_reason text check (pause_reason is null or length(pause_reason) <= 40),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_category text check (last_error_category is null or length(last_error_category) <= 40),
  reported_daily text check (reported_daily is null or length(reported_daily) <= 40),      -- x-resend-daily-quota, as reported
  reported_monthly text check (reported_monthly is null or length(reported_monthly) <= 40), -- x-resend-monthly-quota, as reported
  reported_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.email_provider_state enable row level security;
revoke all on public.email_provider_state from public, anon, authenticated;

-- Recipients ACCEPTED by each provider per UTC day (Resend's day is the UTC calendar day). Counted by this CRM only: the account's real
-- usage (other senders, received mail) is what the provider reports (email_provider_state.reported_*).
create table if not exists public.email_usage_daily (
  provider text not null check (provider in ('resend', 'ses', 'smtp', 'brevo')),
  day date not null,
  accepted_recipients integer not null default 0,
  accepted_messages integer not null default 0,
  primary key (provider, day)
);
alter table public.email_usage_daily enable row level security;
revoke all on public.email_usage_daily from public, anon, authenticated;

-- One alert per provider, period and threshold.
create table if not exists public.email_quota_alerts (
  provider text not null,
  period text not null,          -- 'D2027-01-11' or 'M2027-01'
  threshold integer not null,
  sent_at timestamptz not null default now(),
  primary key (provider, period, threshold)
);
alter table public.email_quota_alerts enable row level security;
revoke all on public.email_quota_alerts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.email_norm(p text) returns text language sql immutable set search_path = '' as $$
  select case when lower(btrim(coalesce(p, ''))) ~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then lower(btrim(p)) end
$$;
create or replace function private.email_mask(p text) returns text language sql immutable set search_path = '' as $$
  select case when position('@' in coalesce(p, '')) > 1 then left(p, 1) || '***@' || split_part(p, '@', 2) else '***' end
$$;
create or replace function private.email_domain_allowed(p_email text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(exists (select 1 from public.email_settings s where s.id and split_part(lower(p_email), '@', 2) = any(s.allowed_sender_domains)), false)
$$;
revoke all on function private.email_norm(text) from public, anon, authenticated;
revoke all on function private.email_mask(text) from public, anon, authenticated;
revoke all on function private.email_domain_allowed(text) from public, anon, authenticated;

-- The employees an assigned-role target names for this e-mail's record. Read live: only ACTIVE accounts, never a stored list.
create or replace function private.email_target_profiles(p_target text, p_customer uuid, p_application uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select x.id from (
    select c.owner_id as id from public.customers c where p_target = 'CUSTOMER_OWNER' and c.id = p_customer
    union all select private.rm_of(p_customer) where p_target = 'RELATIONSHIP_MANAGER' and p_customer is not null
    union all select o.meta_verifier_id from public.customer_onboarding o where p_target = 'META_VERIFIER' and o.customer_id = p_customer
    union all select c.accounts_owner_id from public.customers c where p_target = 'ACCOUNTS_OWNER' and c.id = p_customer
    union all select o.consultant_started_by from public.customer_onboarding o where p_target = 'TECHNICAL_CONSULTANT' and o.customer_id = p_customer
    union all select cp.responsible_id from public.career_applications a join public.career_postings cp on cp.id = a.posting_id
               where p_target = 'RECRUITER' and a.id = p_application
  ) x
  join public.profiles p on p.id = x.id and p.status = 'ACTIVE'
$$;
revoke all on function private.email_target_profiles(text, uuid, uuid) from public, anon, authenticated;

-- CC / BCC for one e-mail: every enabled, effective rule of its category (and application / department / workflow when the rule names
-- one), resolved now. Sensitive categories: nothing, whatever the rules say. Addresses already in `p_exclude` (To, the sender) are dropped;
-- an address that is both CC and BCC stays CC (visible beats hidden, so nobody gets two copies); at most max_auto_recipients in all.
create or replace function private.email_resolve_rules(p_category text, p_application text, p_context jsonb, p_exclude text[], p_rule uuid default null)
returns table (mode text, email text, rule_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := nullif(p_context ->> 'customerId', '')::uuid;
  v_app uuid := nullif(p_context ->> 'applicationId', '')::uuid;
  v_dept uuid := nullif(p_context ->> 'departmentId', '')::uuid;
  v_workflow text := nullif(p_context ->> 'workflow', '');
  v_max integer := coalesce((select max_auto_recipients from public.email_settings where id), 5);
begin
  if private.email_category_sensitive(p_category) then
    return;
  end if;
  return query
  with rules as (
    select r.* from public.email_recipient_rules r
     where (p_rule is not null and r.id = p_rule)
        or (p_rule is null and r.enabled and r.category = p_category
            and (r.application is null or r.application = p_application)
            and (r.department_id is null or r.department_id = v_dept or r.department_id = (select c.department_id from public.customers c where c.id = v_customer))
            and (r.workflow is null or r.workflow = v_workflow)
            and (r.effective_from is null or r.effective_from <= (now() at time zone 'Asia/Kolkata')::date)
            and (r.effective_to is null or r.effective_to >= (now() at time zone 'Asia/Kolkata')::date))
  ),
  resolved as (
    select r.mode, private.email_norm(p.email) as email, r.id as rule_id, r.priority
      from rules r
      cross join lateral (select t from private.email_target_profiles(r.target, v_customer, v_app) t where r.target not in ('PROFILE', 'ADDRESS')
                          union all select u from unnest(r.profile_ids) u where r.target = 'PROFILE') t(pid)
      join public.profiles p on p.id = t.pid and p.status = 'ACTIVE'
     where not (t.pid = any(r.exclude_profile_ids))
    union all
    select r.mode, private.email_norm(a), r.id, r.priority from rules r cross join unnest(r.addresses) a
     where r.target = 'ADDRESS' and private.email_domain_allowed(a)
  ),
  best as (
    select distinct on (rs.email) rs.mode, rs.email, rs.rule_id, rs.priority
      from resolved rs
     where rs.email is not null and not coalesce(rs.email = any(array_remove(coalesce(p_exclude, '{}'), null)), false)
       and not exists (select 1 from public.email_suppressions s where s.email = rs.email and s.active)
     order by rs.email, (rs.mode = 'CC') desc, rs.priority
  )
  select b.mode, b.email, b.rule_id from best b order by b.priority, b.email limit v_max;
end $$;
revoke all on function private.email_resolve_rules(text, text, jsonb, text[], uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Sending (service role, called by server/automations/providers.ts around every send)
-- ---------------------------------------------------------------------------
-- p: { idempotencyKey?, application, category, template?, priority, sensitive, to, cc[], bcc[], senderEmail?, providers[], context{} }
-- Answers: duplicate (already accepted / in progress / unknown), the CC / BCC to use, suppressed addresses, the configured sender of
-- the category, and for each provider whether it may be used now (pause, quota, critical reserve), in the configured order.
create or replace function public.email_send_begin(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.email_settings;
  v_cat text := coalesce(nullif(p ->> 'category', ''), 'GENERAL');
  v_app text := coalesce(nullif(p ->> 'application', ''), 'CRM');
  v_prio text := coalesce(nullif(p ->> 'priority', ''), 'NORMAL');
  v_sensitive boolean := coalesce((p ->> 'sensitive')::boolean, false) or private.email_category_sensitive(v_cat);
  v_to text := private.email_norm(p ->> 'to');
  v_key text := nullif(p ->> 'idempotencyKey', '');
  v_ctx jsonb := coalesce(p -> 'context', '{}'::jsonb);
  v_req_cc text[] := array(select private.email_norm(x) from jsonb_array_elements_text(coalesce(p -> 'cc', '[]')) x where private.email_norm(x) is not null);
  v_req_bcc text[] := array(select private.email_norm(x) from jsonb_array_elements_text(coalesce(p -> 'bcc', '[]')) x where private.email_norm(x) is not null);
  v_cc text[];
  v_bcc text[];
  v_existing public.email_messages;
  v_id uuid;
  v_sender public.email_senders;
  v_providers jsonb := '[]'::jsonb;
  v_order text[];
  v_name text;
  st public.email_provider_state;
  v_used_day integer;
  v_used_month integer;
  v_inflight integer;
  v_limit_day integer;
  v_limit_month integer;
  v_reason text;
  v_suppressed text[];
begin
  if not private.email_category_ok(v_cat) then
    raise exception 'VALIDATION_ERROR: Unknown e-mail category.' using errcode = 'P0001';
  end if;
  if v_to is null then
    raise exception 'VALIDATION_ERROR: The recipient address is not valid.' using errcode = 'P0001';
  end if;
  if v_sensitive and (cardinality(v_req_cc) > 0 or cardinality(v_req_bcc) > 0) then
    raise exception 'VALIDATION_ERROR: Authentication and credential e-mails cannot have CC or BCC recipients.' using errcode = 'P0001';
  end if;
  select * into s from public.email_settings where id;

  -- one send per business event
  if v_key is not null then
    select * into v_existing from public.email_messages where idempotency_key = v_key for update;
    if v_existing.id is not null then
      if v_existing.status in ('ACCEPTED', 'DELIVERY_CONFIRMED', 'DEFERRED', 'BOUNCED', 'COMPLAINED') then
        return jsonb_build_object('duplicate', 'ACCEPTED', 'logId', v_existing.id, 'provider', v_existing.provider, 'providerMessageId', v_existing.provider_message_id);
      elsif v_existing.status = 'PROCESSING' and v_existing.updated_at > now() - interval '2 minutes' then
        return jsonb_build_object('duplicate', 'IN_PROGRESS', 'logId', v_existing.id);
      elsif v_existing.status = 'UNKNOWN_ACCEPTANCE' then
        -- the provider may have taken it: only the same provider, with the same idempotency key, may be asked again
        return jsonb_build_object('duplicate', 'UNKNOWN_ACCEPTANCE', 'logId', v_existing.id, 'provider', v_existing.provider);
      end if;
      v_id := v_existing.id;
    end if;
  end if;

  -- CC / BCC: what the caller asked for (the deployment's EMAIL_CC / EMAIL_BCC) plus the rules, never for sensitive e-mail
  if v_sensitive then
    v_cc := '{}'; v_bcc := '{}';
  else
    v_cc := array(select distinct x from unnest(v_req_cc) x where x <> v_to);
    v_bcc := array(select distinct x from unnest(v_req_bcc) x where x <> v_to and not (x = any(v_cc)));
    v_cc := v_cc || array(select r.email from private.email_resolve_rules(v_cat, v_app, v_ctx, array_remove(array[v_to] || v_cc || v_bcc || array[private.email_norm(p ->> 'senderEmail')], null)) r
                          where r.mode = 'CC');
    v_bcc := v_bcc || array(select r.email from private.email_resolve_rules(v_cat, v_app, v_ctx, array_remove(array[v_to] || v_cc || v_bcc || array[private.email_norm(p ->> 'senderEmail')], null)) r
                            where r.mode = 'BCC');
  end if;
  v_suppressed := array(select e from unnest(array[v_to] || v_cc || v_bcc) e where exists (select 1 from public.email_suppressions x where x.email = e and x.active));
  v_cc := array(select e from unnest(v_cc) e where not (e = any(v_suppressed)));
  v_bcc := array(select e from unnest(v_bcc) e where not (e = any(v_suppressed)));

  select * into v_sender from public.email_senders where category = v_cat and enabled and private.email_domain_allowed(from_email);
  if v_sender.category is null and not v_sensitive then
    select * into v_sender from public.email_senders where category = 'GENERAL' and enabled and private.email_domain_allowed(from_email);
  end if;

  -- the log row (masked recipient for sensitive e-mail)
  if v_id is null then
    insert into public.email_messages (idempotency_key, application, category, template, priority, sender, recipient, cc, bcc, bcc_count,
                                       recipient_count, customer_id, application_id, profile_id, department_id, status)
    values (v_key, v_app, v_cat, left(p ->> 'template', 80), v_prio, left(coalesce(v_sender.from_email, p ->> 'senderEmail'), 200),
            case when v_sensitive then private.email_mask(v_to) else v_to end, v_cc, v_bcc, cardinality(v_bcc),
            1 + cardinality(v_cc) + cardinality(v_bcc),
            (select c.id from public.customers c where c.id = nullif(v_ctx ->> 'customerId', '')::uuid),
            (select a.id from public.career_applications a where a.id = nullif(v_ctx ->> 'applicationId', '')::uuid),
            (select x.id from public.profiles x where x.id = nullif(v_ctx ->> 'profileId', '')::uuid),
            (select d.id from public.departments d where d.id = nullif(v_ctx ->> 'departmentId', '')::uuid),
            case when v_to = any(v_suppressed) then 'SUPPRESSED' else 'PROCESSING' end)
    on conflict (idempotency_key) do nothing
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('duplicate', 'IN_PROGRESS');
    end if;
  else
    update public.email_messages set status = case when v_to = any(v_suppressed) then 'SUPPRESSED' else 'PROCESSING' end, cc = v_cc, bcc = v_bcc,
           bcc_count = cardinality(v_bcc), recipient_count = 1 + cardinality(v_cc) + cardinality(v_bcc), updated_at = now()
     where id = v_id;
  end if;

  -- providers: the configured order (settings, else what the deployment sent), each with whether it may be used now
  v_order := coalesce(s.provider_order, array(select jsonb_array_elements_text(coalesce(p -> 'providers', '[]'))));
  foreach v_name in array v_order loop
    continue when not (v_name = any(array(select jsonb_array_elements_text(coalesce(p -> 'providers', '[]')))));
    select * into st from public.email_provider_state where provider = v_name;
    v_used_day := coalesce((select accepted_recipients from public.email_usage_daily where provider = v_name and day = (now() at time zone 'UTC')::date), 0);
    v_used_month := coalesce((select sum(accepted_recipients) from public.email_usage_daily where provider = v_name
                                and day >= date_trunc('month', now() at time zone 'UTC')::date), 0);
    v_inflight := (select coalesce(sum(recipient_count), 0) from public.email_messages where planned_provider = v_name and status = 'PROCESSING'
                     and updated_at > now() - interval '2 minutes');
    v_limit_day := case v_name when 'resend' then s.resend_daily_limit when 'ses' then s.ses_daily_limit end;
    v_limit_month := case v_name when 'resend' then s.resend_monthly_limit end;
    v_reason := case
      when st.paused_until > now() then coalesce(st.pause_reason, 'PAUSED')
      when v_limit_day is not null and v_used_day + v_inflight + 1 + cardinality(v_cc) + cardinality(v_bcc) > v_limit_day then 'QUOTA_DAILY'
      when v_limit_month is not null and v_used_month + v_inflight + 1 + cardinality(v_cc) + cardinality(v_bcc) > v_limit_month then 'QUOTA_MONTHLY'
      -- the last few of the day are kept for CRITICAL e-mail (sign-in codes, password resets)
      when v_prio <> 'CRITICAL' and v_limit_day is not null and v_used_day + v_inflight + 1 + cardinality(v_cc) + cardinality(v_bcc) > v_limit_day - s.critical_reserve
        then 'CRITICAL_RESERVE'
      when v_prio <> 'CRITICAL' and v_limit_month is not null and v_used_month + v_inflight + 1 + cardinality(v_cc) + cardinality(v_bcc) > v_limit_month - s.critical_reserve
        then 'CRITICAL_RESERVE'
    end;
    v_providers := v_providers || jsonb_build_object('provider', v_name, 'allowed', v_reason is null, 'reason', v_reason);
  end loop;
  update public.email_messages set planned_provider = (select x ->> 'provider' from jsonb_array_elements(v_providers) x where (x ->> 'allowed')::boolean limit 1)
   where id = v_id;

  return jsonb_build_object('logId', v_id, 'duplicate', null, 'cc', to_jsonb(v_cc), 'bcc', to_jsonb(v_bcc), 'suppressed', to_jsonb(v_suppressed),
    'sender', case when v_sender.category is null then null else jsonb_build_object('email', v_sender.from_email, 'name', v_sender.from_name, 'replyTo', v_sender.reply_to) end,
    'providers', v_providers);
end $$;
revoke all on function public.email_send_begin(jsonb) from public, anon, authenticated;
grant execute on function public.email_send_begin(jsonb) to service_role;

-- p: { logId, status, provider?, providerMessageId?, fallbackUsed, attempts: [{ provider, outcome, category, status, ref, ms }],
--      usage?: { provider, daily?, monthly? } }
create or replace function public.email_send_finish(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.email_messages;
  a record;
  v_status text := p ->> 'status';
  v_provider text := nullif(p ->> 'provider', '');
  v_until timestamptz;
  s public.email_settings;
  v_used integer;
  v_limit integer;
  t integer;
  v_period text;
begin
  select * into m from public.email_messages where id = (p ->> 'logId')::uuid for update;
  if m.id is null then
    return;
  end if;
  if v_status not in ('ACCEPTED', 'FAILED', 'RETRY_PENDING', 'UNKNOWN_ACCEPTANCE', 'SUPPRESSED', 'CANCELLED', 'EXPIRED') then
    raise exception 'VALIDATION_ERROR: Unknown e-mail status.' using errcode = 'P0001';
  end if;
  for a in select * from jsonb_to_recordset(coalesce(p -> 'attempts', '[]'))
             as x(provider text, outcome text, category text, status integer, ref text, ms integer)
  loop
    continue when a.provider not in ('resend', 'ses', 'smtp', 'brevo');
    insert into public.email_attempts (message_id, provider, outcome, error_category, status_code, provider_message_id, duration_ms)
    values (m.id, a.provider, a.outcome, left(a.category, 40), a.status, left(a.ref, 300), a.ms);
    -- shared provider state: one instance's quota refusal pauses the provider for every instance
    insert into public.email_provider_state (provider) values (a.provider) on conflict do nothing;
    -- only what waiting resolves is paused for every instance (a quota until it resets, a rate limit briefly, the SES sandbox); a wrong key,
    -- an unverified domain or a suspended account is recorded but not paused, so fixing the setting takes effect on the next e-mail
    v_until := case a.category
      when 'QUOTA_DAILY' then (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC'
      when 'QUOTA_MONTHLY' then (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC'
      when 'RATE_LIMIT' then now() + interval '30 seconds'
      when 'SES_SANDBOX' then now() + interval '1 hour'
    end;
    if a.outcome = 'ACCEPTED' then
      update public.email_provider_state set last_success_at = now(), updated_at = now() where provider = a.provider;
    elsif a.outcome in ('REJECTED', 'RETRYABLE', 'UNKNOWN_ACCEPTANCE') then
      update public.email_provider_state
         set last_error_at = now(), last_error_category = left(a.category, 40), updated_at = now(),
             paused_until = coalesce(greatest(paused_until, v_until), paused_until), pause_reason = case when v_until is not null then left(a.category, 40) else pause_reason end
       where provider = a.provider;
    end if;
  end loop;
  if p ? 'usage' and (p -> 'usage' ->> 'provider') in ('resend', 'ses') then
    update public.email_provider_state set reported_daily = left(p -> 'usage' ->> 'daily', 40), reported_monthly = left(p -> 'usage' ->> 'monthly', 40),
           reported_at = now() where provider = p -> 'usage' ->> 'provider';
  end if;
  update public.email_messages
     set status = v_status, provider = coalesce(v_provider, provider), provider_message_id = coalesce(left(p ->> 'providerMessageId', 300), provider_message_id),
         fallback_used = coalesce((p ->> 'fallbackUsed')::boolean, false), attempts = attempts + jsonb_array_length(coalesce(p -> 'attempts', '[]')),
         error_category = case when v_status = 'ACCEPTED' then null else left(p ->> 'errorCategory', 40) end,
         submitted_at = coalesce(submitted_at, now()), accepted_at = case when v_status = 'ACCEPTED' then now() else accepted_at end, updated_at = now()
   where id = m.id;
  if v_status = 'ACCEPTED' and v_provider is not null then
    insert into public.email_usage_daily (provider, day, accepted_recipients, accepted_messages)
    values (v_provider, (now() at time zone 'UTC')::date, m.recipient_count, 1)
    on conflict (provider, day) do update set accepted_recipients = public.email_usage_daily.accepted_recipients + excluded.accepted_recipients,
                                              accepted_messages = public.email_usage_daily.accepted_messages + 1;
    -- quota alerts to the Super Admin, once per threshold and period
    select * into s from public.email_settings where id;
    foreach t in array s.quota_thresholds loop
      for v_period, v_used, v_limit in
        select 'D' || (now() at time zone 'UTC')::date, (select accepted_recipients from public.email_usage_daily where provider = v_provider and day = (now() at time zone 'UTC')::date),
               case v_provider when 'resend' then s.resend_daily_limit when 'ses' then s.ses_daily_limit end
        union all
        select 'M' || to_char(now() at time zone 'UTC', 'YYYY-MM'),
               (select sum(accepted_recipients)::integer from public.email_usage_daily where provider = v_provider and day >= date_trunc('month', now() at time zone 'UTC')::date),
               case v_provider when 'resend' then s.resend_monthly_limit end
      loop
        continue when v_limit is null or v_limit = 0 or v_used * 100 < t * v_limit;
        insert into public.email_quota_alerts (provider, period, threshold) values (v_provider, v_period, t) on conflict do nothing;
        if found then
          perform private.notify(x.id, 'EMAIL_QUOTA_ALERT', format('E-mail usage at %s%% (%s)', t, v_provider),
            format('%s of %s e-mails used (%s, counted by the CRM). Check Email Management → Usage & Limits.', v_used, v_limit,
                   case when v_period like 'D%' then 'today' else 'this month' end), 'email_settings', null,
            jsonb_build_object('provider', v_provider, 'threshold', t, 'period', v_period), case when t >= 95 then 'urgent' else 'normal' end)
            from public.profiles x where x.role = 'SUPER_ADMIN' and x.status = 'ACTIVE';
        end if;
      end loop;
    end loop;
  end if;
end $$;
revoke all on function public.email_send_finish(jsonb) from public, anon, authenticated;
grant execute on function public.email_send_finish(jsonb) to service_role;

-- A provider event (Resend webhook, already signature-checked by the API): once per event id. Delivered / bounced / complained /
-- delayed update the message; a hard bounce or a complaint suppresses the address for EVERY provider.
-- p: { provider, eventId, type, providerMessageId, occurredAt, recipients[], bounceType }
create or replace function public.email_provider_event(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := p ->> 'provider';
  v_type text := p ->> 'type';
  v_msg public.email_messages;
  v_hard boolean;
  r text;
begin
  if v_provider not in ('resend', 'ses') or coalesce(p ->> 'eventId', '') = '' or coalesce(v_type, '') = '' then
    raise exception 'VALIDATION_ERROR: Not a provider event.' using errcode = 'P0001';
  end if;
  select * into v_msg from public.email_messages where provider = v_provider and provider_message_id = p ->> 'providerMessageId' for update;
  insert into public.email_events (provider, provider_event_id, event_type, provider_message_id, message_id, bounce_type, occurred_at)
  values (v_provider, left(p ->> 'eventId', 200), left(v_type, 60), left(p ->> 'providerMessageId', 300), v_msg.id, left(p ->> 'bounceType', 40),
          coalesce((p ->> 'occurredAt')::timestamptz, now()))
  on conflict (provider, provider_event_id) do nothing;
  if not found then
    return jsonb_build_object('duplicate', true);
  end if;
  v_hard := v_type = 'email.complained' or (v_type = 'email.bounced' and lower(coalesce(p ->> 'bounceType', 'permanent')) not in ('transient', 'temporary', 'undetermined'));
  if v_msg.id is not null then
    update public.email_messages set
      status = case
        when v_type = 'email.delivered' and status in ('ACCEPTED', 'DEFERRED', 'UNKNOWN_ACCEPTANCE') then 'DELIVERY_CONFIRMED'
        when v_type = 'email.delivery_delayed' and status in ('ACCEPTED', 'UNKNOWN_ACCEPTANCE') then 'DEFERRED'
        when v_type = 'email.bounced' then 'BOUNCED'
        when v_type = 'email.complained' then 'COMPLAINED'
        when v_type = 'email.failed' and status in ('ACCEPTED', 'DEFERRED', 'UNKNOWN_ACCEPTANCE') then 'FAILED'
        when v_type = 'email.sent' and status = 'UNKNOWN_ACCEPTANCE' then 'ACCEPTED'
        else status end,
      delivered_at = case when v_type = 'email.delivered' then coalesce((p ->> 'occurredAt')::timestamptz, now()) else delivered_at end,
      bounced_at = case when v_type = 'email.bounced' then coalesce((p ->> 'occurredAt')::timestamptz, now()) else bounced_at end,
      complained_at = case when v_type = 'email.complained' then coalesce((p ->> 'occurredAt')::timestamptz, now()) else complained_at end,
      updated_at = now()
     where id = v_msg.id;
  end if;
  if v_hard then
    for r in select private.email_norm(x) from jsonb_array_elements_text(coalesce(p -> 'recipients', '[]')) x loop
      continue when r is null;
      insert into public.email_suppressions (email, reason, source) values (r, case when v_type = 'email.complained' then 'COMPLAINT' else 'HARD_BOUNCE' end, v_provider)
      on conflict (email) do update set active = true, reason = excluded.reason, source = excluded.source, updated_at = now()
       where public.email_suppressions.reason <> 'MANUAL' or public.email_suppressions.active;
    end loop;
  end if;
  return jsonb_build_object('duplicate', false, 'matched', v_msg.id is not null);
end $$;
revoke all on function public.email_provider_event(jsonb) from public, anon, authenticated;
grant execute on function public.email_provider_event(jsonb) to service_role;

-- History older than 180 days (attempts and events 90) is removed a little at a time.
create or replace function public.email_purge_old()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.email_attempts where id in (select id from public.email_attempts where attempted_at < now() - interval '90 days' limit 5000);
  delete from public.email_events where id in (select id from public.email_events where received_at < now() - interval '90 days' limit 5000);
  delete from public.email_messages where id in (select id from public.email_messages where created_at < now() - interval '180 days' limit 5000);
  delete from public.email_usage_daily where day < (now() at time zone 'UTC')::date - 400;
  delete from public.email_quota_alerts where sent_at < now() - interval '400 days';
end $$;
revoke all on function public.email_purge_old() from public, anon, authenticated;
grant execute on function public.email_purge_old() to service_role;

-- ---------------------------------------------------------------------------
-- 5. Super Admin: Email Management (every change audited)
-- ---------------------------------------------------------------------------
create or replace function private.require_email_admin()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE' and role = 'SUPER_ADMIN';
  if me.id is null then
    raise exception 'FORBIDDEN: Only the Super Admin manages e-mail.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.require_email_admin() from public, anon, authenticated;

create or replace function private.email_settings_json()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('providerOrder', to_jsonb(s.provider_order), 'quotaThresholds', to_jsonb(s.quota_thresholds),
    'resendDailyLimit', s.resend_daily_limit, 'resendMonthlyLimit', s.resend_monthly_limit, 'sesDailyLimit', s.ses_daily_limit,
    'criticalReserve', s.critical_reserve, 'maxAutoRecipients', s.max_auto_recipients, 'allowedSenderDomains', to_jsonb(s.allowed_sender_domains),
    'updatedAt', s.updated_at)
  from public.email_settings s where s.id
$$;
revoke all on function private.email_settings_json() from public, anon, authenticated;

-- Overview: today's counts (UTC day, as the providers count), provider state and usage, settings, senders, rules.
create or replace function public.email_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
  v_day date := (now() at time zone 'UTC')::date;
begin
  return jsonb_build_object(
    'settings', private.email_settings_json(),
    'today', (select jsonb_build_object(
        'submitted', count(*), 'accepted', count(*) filter (where status in ('ACCEPTED', 'DELIVERY_CONFIRMED', 'DEFERRED', 'BOUNCED', 'COMPLAINED')),
        'deliveryConfirmed', count(*) filter (where status = 'DELIVERY_CONFIRMED'), 'failed', count(*) filter (where status = 'FAILED'),
        'bounced', count(*) filter (where status = 'BOUNCED'), 'complained', count(*) filter (where status = 'COMPLAINED'),
        'unknown', count(*) filter (where status = 'UNKNOWN_ACCEPTANCE'), 'suppressed', count(*) filter (where status = 'SUPPRESSED'),
        'retryPending', count(*) filter (where status = 'RETRY_PENDING'), 'processing', count(*) filter (where status = 'PROCESSING'),
        'fallbacks', count(*) filter (where fallback_used))
      from public.email_messages where created_at >= v_day::timestamp at time zone 'UTC'),
    'providers', (select coalesce(jsonb_agg(jsonb_build_object('provider', x.provider, 'pausedUntil', st.paused_until, 'pauseReason', st.pause_reason,
        'lastSuccessAt', st.last_success_at, 'lastErrorAt', st.last_error_at, 'lastErrorCategory', st.last_error_category,
        'reportedDaily', st.reported_daily, 'reportedMonthly', st.reported_monthly, 'reportedAt', st.reported_at,
        'usedToday', coalesce((select accepted_recipients from public.email_usage_daily u where u.provider = x.provider and u.day = v_day), 0),
        'usedMonth', coalesce((select sum(accepted_recipients) from public.email_usage_daily u where u.provider = x.provider and u.day >= date_trunc('month', v_day)::date), 0))
        order by x.provider), '[]'::jsonb)
      from (values ('resend'), ('ses'), ('smtp')) x(provider) left join public.email_provider_state st on st.provider = x.provider),
    'senders', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'fromEmail', from_email, 'fromName', from_name, 'replyTo', reply_to,
        'enabled', enabled, 'updatedAt', updated_at) order by category), '[]'::jsonb) from public.email_senders),
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'category', r.category, 'application', r.application,
        'departmentId', r.department_id, 'workflow', r.workflow, 'mode', r.mode, 'target', r.target, 'profileIds', to_jsonb(r.profile_ids),
        'addresses', to_jsonb(r.addresses), 'excludeProfileIds', to_jsonb(r.exclude_profile_ids), 'priority', r.priority, 'enabled', r.enabled,
        'effectiveFrom', r.effective_from, 'effectiveTo', r.effective_to, 'updatedAt', r.updated_at) order by r.priority, r.name), '[]'::jsonb)
      from public.email_recipient_rules r),
    'suppressions', (select count(*) from public.email_suppressions where active),
    'webhookEvents24h', (select count(*) from public.email_events where received_at > now() - interval '24 hours'),
    'lastWebhookAt', (select max(received_at) from public.email_events));
end $$;
revoke all on function public.email_admin_overview() from public, anon;
grant execute on function public.email_admin_overview() to authenticated;

create or replace function public.email_settings_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
  v_order text[] := case when p ? 'providerOrder' and jsonb_typeof(p -> 'providerOrder') = 'array'
                         then array(select jsonb_array_elements_text(p -> 'providerOrder')) end;
  v_thr integer[] := array(select (x)::integer from jsonb_array_elements_text(coalesce(p -> 'quotaThresholds', '[70,85,95,100]')) x);
  v_domains text[] := array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'allowedSenderDomains', '["amuwa.com"]')) x);
begin
  if v_order is not null and (cardinality(v_order) not between 1 and 3 or not (v_order <@ '{resend,ses,smtp}'::text[])
                              or cardinality(v_order) <> (select count(distinct x) from unnest(v_order) x)) then
    raise exception 'VALIDATION_ERROR: Choose the providers in order from Resend, Amazon SES and SMTP, each once.' using errcode = 'P0001';
  end if;
  if cardinality(v_thr) not between 1 and 6 or exists (select 1 from unnest(v_thr) t where t not between 1 and 100) then
    raise exception 'VALIDATION_ERROR: Alert thresholds are percentages from 1 to 100 (at most six).' using errcode = 'P0001';
  end if;
  if cardinality(v_domains) not between 1 and 5 or exists (select 1 from unnest(v_domains) d where d !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$') then
    raise exception 'VALIDATION_ERROR: List one to five sender domains, e.g. amuwa.com.' using errcode = 'P0001';
  end if;
  update public.email_settings set
    provider_order = v_order,
    quota_thresholds = (select array_agg(distinct t order by t) from unnest(v_thr) t),
    resend_daily_limit = coalesce((p ->> 'resendDailyLimit')::integer, resend_daily_limit),
    resend_monthly_limit = coalesce((p ->> 'resendMonthlyLimit')::integer, resend_monthly_limit),
    ses_daily_limit = case when p ? 'sesDailyLimit' then (p ->> 'sesDailyLimit')::integer else ses_daily_limit end,
    critical_reserve = coalesce((p ->> 'criticalReserve')::integer, critical_reserve),
    max_auto_recipients = coalesce((p ->> 'maxAutoRecipients')::integer, max_auto_recipients),
    allowed_sender_domains = v_domains,
    updated_at = now(), updated_by = me.id
   where id;
  perform private.write_audit('EMAIL_SETTINGS_UPDATED', 'email_settings', null, null, null, private.email_settings_json());
  return private.email_settings_json();
exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'VALIDATION_ERROR: One of the e-mail settings is out of range.' using errcode = 'P0001';
end $$;
revoke all on function public.email_settings_save(jsonb) from public, anon;
grant execute on function public.email_settings_save(jsonb) to authenticated;

create or replace function public.email_sender_save(p_category text, p_from_email text, p_from_name text, p_reply_to text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
  v_from text := private.email_norm(p_from_email);
  v_reply text := private.email_norm(nullif(btrim(coalesce(p_reply_to, '')), ''));
begin
  if not private.email_category_ok(p_category) then
    raise exception 'VALIDATION_ERROR: Unknown e-mail category.' using errcode = 'P0001';
  end if;
  if v_from is null or not private.email_domain_allowed(v_from) then
    raise exception 'VALIDATION_ERROR: The sender must be an address on an allowed sender domain (verified with the provider), e.g. careers@amuwa.com.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_reply_to, '')), '') is not null and v_reply is null then
    raise exception 'VALIDATION_ERROR: The reply-to address is not valid.' using errcode = 'P0001';
  end if;
  if coalesce(length(btrim(p_from_name)), 0) not between 1 and 80 or p_from_name ~ '[<>"\r\n]' then
    raise exception 'VALIDATION_ERROR: Enter a sender name of up to 80 characters (no < > or quotes).' using errcode = 'P0001';
  end if;
  insert into public.email_senders (category, from_email, from_name, reply_to, enabled, updated_by)
  values (p_category, v_from, btrim(p_from_name), v_reply, coalesce(p_enabled, true), me.id)
  on conflict (category) do update set from_email = excluded.from_email, from_name = excluded.from_name, reply_to = excluded.reply_to,
                                       enabled = excluded.enabled, updated_at = now(), updated_by = me.id;
  perform private.write_audit('EMAIL_SENDER_UPDATED', 'email_settings', null, null, null,
    jsonb_build_object('category', p_category, 'from', v_from, 'replyTo', v_reply, 'enabled', coalesce(p_enabled, true)));
end $$;
revoke all on function public.email_sender_save(text, text, text, text, boolean) from public, anon;
grant execute on function public.email_sender_save(text, text, text, text, boolean) to authenticated;

create or replace function public.email_sender_delete(p_category text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
begin
  delete from public.email_senders where category = p_category;
  perform private.write_audit('EMAIL_SENDER_REMOVED', 'email_settings', null, null, null, jsonb_build_object('category', p_category));
end $$;
revoke all on function public.email_sender_delete(text) from public, anon;
grant execute on function public.email_sender_delete(text) to authenticated;

-- Create (no id) or change a rule. A rule never applies to AUTH / CREDENTIALS (the table refuses it). Audited with before / after.
create or replace function public.email_rule_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_before jsonb;
  v_cat text := p ->> 'category';
  v_addresses text[] := array(select private.email_norm(x) from jsonb_array_elements_text(coalesce(p -> 'addresses', '[]')) x);
  v_profiles uuid[] := array(select (x)::uuid from jsonb_array_elements_text(coalesce(p -> 'profileIds', '[]')) x);
begin
  if v_cat is null or not private.email_category_ok(v_cat) then
    raise exception 'VALIDATION_ERROR: Choose an e-mail category.' using errcode = 'P0001';
  end if;
  if private.email_category_sensitive(v_cat) then
    raise exception 'VALIDATION_ERROR: Authentication and credential e-mails can never be copied to anyone.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_addresses) a where a is null or not private.email_domain_allowed(a)) then
    raise exception 'VALIDATION_ERROR: Copies can go only to company addresses on an allowed sender domain.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_profiles) x where not exists (select 1 from public.profiles pr where pr.id = x and pr.status = 'ACTIVE')) then
    raise exception 'VALIDATION_ERROR: Choose active employees only.' using errcode = 'P0001';
  end if;
  if v_id is not null then
    select to_jsonb(r) into v_before from public.email_recipient_rules r where id = v_id;
    if v_before is null then
      raise exception 'NOT_FOUND: Rule not found.' using errcode = 'P0001';
    end if;
    update public.email_recipient_rules set name = btrim(p ->> 'name'), category = v_cat, application = nullif(p ->> 'application', ''),
           department_id = nullif(p ->> 'departmentId', '')::uuid, workflow = nullif(btrim(coalesce(p ->> 'workflow', '')), ''),
           mode = p ->> 'mode', target = p ->> 'target', profile_ids = v_profiles, addresses = v_addresses,
           exclude_profile_ids = array(select (x)::uuid from jsonb_array_elements_text(coalesce(p -> 'excludeProfileIds', '[]')) x),
           priority = coalesce((p ->> 'priority')::integer, 100), enabled = coalesce((p ->> 'enabled')::boolean, false),
           effective_from = nullif(p ->> 'effectiveFrom', '')::date, effective_to = nullif(p ->> 'effectiveTo', '')::date,
           updated_at = now(), updated_by = me.id
     where id = v_id;
  else
    insert into public.email_recipient_rules (name, category, application, department_id, workflow, mode, target, profile_ids, addresses,
                                              exclude_profile_ids, priority, enabled, effective_from, effective_to, created_by, updated_by)
    values (btrim(p ->> 'name'), v_cat, nullif(p ->> 'application', ''), nullif(p ->> 'departmentId', '')::uuid, nullif(btrim(coalesce(p ->> 'workflow', '')), ''),
            p ->> 'mode', p ->> 'target', v_profiles, v_addresses,
            array(select (x)::uuid from jsonb_array_elements_text(coalesce(p -> 'excludeProfileIds', '[]')) x),
            coalesce((p ->> 'priority')::integer, 100), coalesce((p ->> 'enabled')::boolean, false),
            nullif(p ->> 'effectiveFrom', '')::date, nullif(p ->> 'effectiveTo', '')::date, me.id, me.id)
    returning id into v_id;
  end if;
  perform private.write_audit(case when v_before is null then 'EMAIL_RULE_CREATED' else 'EMAIL_RULE_UPDATED' end, 'email_settings', v_id, null, null,
    jsonb_build_object('before', v_before, 'after', (select to_jsonb(r) from public.email_recipient_rules r where id = v_id)));
  return v_id;
exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'VALIDATION_ERROR: Fill in the rule: name, category, CC or BCC, who is copied (and the employees or addresses it names).' using errcode = 'P0001';
end $$;
revoke all on function public.email_rule_save(jsonb) from public, anon;
grant execute on function public.email_rule_save(jsonb) to authenticated;

create or replace function public.email_rule_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
  v_before jsonb;
begin
  delete from public.email_recipient_rules where id = p_id returning to_jsonb(email_recipient_rules.*) into v_before;
  if v_before is null then
    raise exception 'NOT_FOUND: Rule not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit('EMAIL_RULE_DELETED', 'email_settings', p_id, null, null, jsonb_build_object('before', v_before));
end $$;
revoke all on function public.email_rule_delete(uuid) from public, anon;
grant execute on function public.email_rule_delete(uuid) to authenticated;

-- Who a rule would copy for a REAL record (a customer or a job application): the preview before enabling it. Masked addresses with names.
create or replace function public.email_rule_preview(p_rule uuid, p_customer uuid default null, p_application uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
  r public.email_recipient_rules;
begin
  select * into r from public.email_recipient_rules where id = p_rule;
  if r.id is null then
    raise exception 'NOT_FOUND: Rule not found.' using errcode = 'P0001';
  end if;
  if p_customer is null and p_application is null then
    raise exception 'VALIDATION_ERROR: Choose a customer or a job application to preview with.' using errcode = 'P0001';
  end if;
  if (p_customer is not null and not exists (select 1 from public.customers where id = p_customer))
     or (p_application is not null and not exists (select 1 from public.career_applications where id = p_application)) then
    raise exception 'NOT_FOUND: That record does not exist.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('rule', r.name, 'recipients', coalesce((
    select jsonb_agg(jsonb_build_object('mode', x.mode, 'email', x.email,
             'name', (select p.full_name from public.profiles p where lower(p.email) = x.email and p.status = 'ACTIVE' limit 1)) order by x.mode, x.email)
      from private.email_resolve_rules(r.category, coalesce(r.application, 'CRM'),
             jsonb_build_object('customerId', p_customer, 'applicationId', p_application, 'workflow', r.workflow, 'departmentId', r.department_id), '{}', r.id) x), '[]'::jsonb));
end $$;
revoke all on function public.email_rule_preview(uuid, uuid, uuid) from public, anon;
grant execute on function public.email_rule_preview(uuid, uuid, uuid) to authenticated;

create or replace function public.email_suppression_set(p_email text, p_active boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
  v text := private.email_norm(p_email);
begin
  if v is null then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  insert into public.email_suppressions (email, active, reason, source, note, updated_by)
  values (v, coalesce(p_active, true), 'MANUAL', 'admin', left(p_note, 300), me.id)
  on conflict (email) do update set active = excluded.active, note = coalesce(excluded.note, public.email_suppressions.note),
                                    reason = case when excluded.active then 'MANUAL' else public.email_suppressions.reason end,
                                    updated_at = now(), updated_by = me.id;
  perform private.write_audit(case when coalesce(p_active, true) then 'EMAIL_SUPPRESSED' else 'EMAIL_UNSUPPRESSED' end, 'email_settings', null, null, null,
    jsonb_build_object('email', private.email_mask(v), 'note', left(p_note, 300)));
end $$;
revoke all on function public.email_suppression_set(text, boolean, text) from public, anon;
grant execute on function public.email_suppression_set(text, boolean, text) to authenticated;

create or replace function public.email_suppressions_list(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('email', email, 'active', active, 'reason', reason, 'source', source, 'note', note,
           'updatedAt', updated_at) order by updated_at desc)
    from (select * from public.email_suppressions where p_search is null or email like '%' || lower(btrim(p_search)) || '%' order by updated_at desc limit 200) s), '[]'::jsonb);
end $$;
revoke all on function public.email_suppressions_list(text) from public, anon;
grant execute on function public.email_suppressions_list(text) to authenticated;

-- An e-mail whose outcome is unknown (the provider did not answer in time) is never sent again automatically: the Super Admin checks the
-- provider's own log and then marks it as not received (status FAILED: the next send of the same event goes out) or as received (ACCEPTED).
create or replace function public.email_message_review(p_id uuid, p_received boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_email_admin();
  m public.email_messages;
begin
  select * into m from public.email_messages where id = p_id for update;
  if m.id is null then
    raise exception 'NOT_FOUND: E-mail not found.' using errcode = 'P0001';
  end if;
  if m.status <> 'UNKNOWN_ACCEPTANCE' then
    raise exception 'CONFLICT: Only an e-mail whose outcome is unknown can be reviewed.' using errcode = 'P0001';
  end if;
  update public.email_messages set status = case when p_received then 'ACCEPTED' else 'FAILED' end,
         error_category = case when p_received then null else 'REVIEWED_NOT_RECEIVED' end,
         accepted_at = case when p_received then coalesce(accepted_at, now()) else accepted_at end, updated_at = now()
   where id = p_id;
  perform private.write_audit('EMAIL_OUTCOME_REVIEWED', 'email_settings', p_id, null, null,
    jsonb_build_object('received', p_received, 'category', m.category, 'provider', m.provider));
end $$;
revoke all on function public.email_message_review(uuid, boolean) from public, anon;
grant execute on function public.email_message_review(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. E-mail history: what each person may see
-- ---------------------------------------------------------------------------
-- Super Admin: everything (recipients in full except authentication e-mails, which are masked anyway; BCC addresses only here).
-- HR staff (not recruiters): recruitment, interview and HR e-mails. A recruiter: e-mails of the applications of their own vacancies.
-- Everyone else: e-mails linked to a customer they may see (private.can_view_customer), never authentication / credential ones.
-- Status and timing only: message bodies are never stored.
create or replace function private.email_visible(m public.email_messages, me public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when me.role = 'SUPER_ADMIN' then true
    when private.email_category_sensitive(m.category) then false
    when m.category in ('RECRUITMENT', 'INTERVIEW', 'HR') and private.is_hr_staff() then true
    when m.category in ('RECRUITMENT', 'INTERVIEW') and m.application_id is not null and exists (
           select 1 from public.career_applications a join public.career_postings cp on cp.id = a.posting_id
            where a.id = m.application_id and cp.responsible_id = me.id) then true
    when m.customer_id is not null and m.category not in ('RECRUITMENT', 'INTERVIEW', 'HR') then private.can_view_customer(m.customer_id)
    else false end
$$;
revoke all on function private.email_visible(public.email_messages, public.profiles) from public, anon, authenticated;

create or replace function public.email_history(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_limit integer := least(greatest(coalesce((p ->> 'limit')::integer, 50), 1), 200);
  v_offset integer := greatest(coalesce((p ->> 'offset')::integer, 0), 0);
  v_search text := nullif(lower(btrim(coalesce(p ->> 'recipient', ''))), '');
  v_rows jsonb;
  v_total integer;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  with f as (
    select m.* from public.email_messages m
     where (nullif(p ->> 'application', '') is null or m.application = p ->> 'application')
       and (nullif(p ->> 'category', '') is null or m.category = p ->> 'category')
       and (nullif(p ->> 'status', '') is null or m.status = p ->> 'status' or (p ->> 'status' = 'PROBLEMS' and m.status in ('FAILED', 'BOUNCED', 'COMPLAINED', 'UNKNOWN_ACCEPTANCE', 'SUPPRESSED')))
       and (nullif(p ->> 'provider', '') is null or m.provider = p ->> 'provider')
       and (nullif(p ->> 'departmentId', '') is null or m.department_id = (p ->> 'departmentId')::uuid
            or m.customer_id in (select c.id from public.customers c where c.department_id = (p ->> 'departmentId')::uuid))
       and (nullif(p ->> 'from', '') is null or m.created_at >= (p ->> 'from')::date::timestamp at time zone 'Asia/Kolkata')
       and (nullif(p ->> 'to', '') is null or m.created_at < ((p ->> 'to')::date + 1)::timestamp at time zone 'Asia/Kolkata')
       and (v_search is null or m.recipient like '%' || v_search || '%')
       and private.email_visible(m, me)
  )
  select count(*)::integer, coalesce((select jsonb_agg(row order by (row ->> 'createdAt') desc) from (
      select jsonb_build_object('id', f.id, 'application', f.application, 'category', f.category, 'template', f.template, 'priority', f.priority,
        'sender', f.sender, 'recipient', f.recipient, 'cc', to_jsonb(f.cc), 'bccCount', f.bcc_count,
        'bcc', case when me.role = 'SUPER_ADMIN' then to_jsonb(f.bcc) else null end,
        'status', f.status, 'provider', f.provider, 'fallbackUsed', f.fallback_used, 'attempts', f.attempts, 'errorCategory', f.error_category,
        'customerId', f.customer_id, 'applicationId', f.application_id,
        'createdAt', f.created_at, 'acceptedAt', f.accepted_at, 'deliveredAt', f.delivered_at, 'bouncedAt', f.bounced_at, 'complainedAt', f.complained_at) as row
        from f order by f.created_at desc limit v_limit offset v_offset) x), '[]'::jsonb)
    into v_total, v_rows from f;
  return jsonb_build_object('total', v_total, 'items', v_rows);
end $$;
revoke all on function public.email_history(jsonb) from public, anon;
grant execute on function public.email_history(jsonb) to authenticated;

-- The attempts and provider events of one e-mail (same visibility).
create or replace function public.email_history_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  m public.email_messages;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  select * into m from public.email_messages where id = p_id;
  if me.id is null or m.id is null or not private.email_visible(m, me) then
    raise exception 'NOT_FOUND: E-mail not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'outcome', outcome, 'errorCategory', error_category, 'statusCode', status_code,
                   'ms', duration_ms, 'at', attempted_at) order by id), '[]'::jsonb) from public.email_attempts where message_id = p_id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', event_type, 'bounceType', bounce_type, 'at', coalesce(occurred_at, received_at)) order by id), '[]'::jsonb)
                 from public.email_events where message_id = p_id));
end $$;
revoke all on function public.email_history_detail(uuid) from public, anon;
grant execute on function public.email_history_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
