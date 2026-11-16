-- =============================================================================
-- Lead welcome WhatsApp: "the services of Amuwa Corporation", sent once when a lead is first given to a sales person
--
-- When a lead (customers.lifecycle_stage = 'LEAD') gets its first sales person, the lead receives one WhatsApp message (an approved template,
-- sent through Wabastore by the server). Who counts as a sales person:
--   * an ACTIVE Team Member or Team Lead whose team is a Sales team (teams.division = 'SALES'), telecallers and field sellers included;
--   * an ACTIVE Business Associate (sales_sub_role = 'BUSINESS_ASSOCIATE').
-- A lead owned by a Department Head or the Super Admin (who usually pass it on) waits: the message goes when it reaches a sales person.
-- Once per lead, ever: reassigning it, uploading the same sheet again or saving it again adds nothing (unique key LEADWA|<lead>).
-- Leads assigned before the settings are switched on are not messaged (no backfill): only an assignment made while it is on queues a message.
--
--   lead_whatsapp_settings     one row: on/off, the template (name, language, approved) and which CRM value fills each template variable
--   lead_whatsapp_dispatches   one row per lead: PENDING -> PROCESSING -> ACCEPTED -> DELIVERED -> READ, or RETRY (10 then 30 min, 3 attempts)
--                              -> FAILED; DRY_RUN (decided, not sent) and SKIPPED (with the reason) too. ACCEPTED is NOT delivered.
--   lead_whatsapp_events       the history of each dispatch
--
-- The trigger never blocks saving a lead: any problem is recorded (or ignored), never raised. Re-runnable. Nothing is sent by this migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
create table if not exists public.lead_whatsapp_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- the template as registered with the provider (Meta rules: lower case letters, digits and underscores)
  template_name text check (template_name is null or template_name ~ '^[a-z0-9_]{1,255}$'),
  template_language text not null default 'en' check (template_language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  -- set by a person who has checked that the provider has approved this template; a live send needs it
  template_approved boolean not null default false,
  -- the template's {{1}}, {{2}} ... in order: which CRM value fills each
  variables text[] not null default array['LEAD_NAME', 'SALES_PERSON_NAME']
    check (cardinality(variables) <= 10 and variables <@ array['LEAD_NAME', 'LEAD_COMPANY', 'SALES_PERSON_NAME', 'SALES_PERSON_PHONE']),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.lead_whatsapp_settings (id) values (true) on conflict (id) do nothing;
alter table public.lead_whatsapp_settings enable row level security;
revoke all on public.lead_whatsapp_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Dispatches and their history
-- ---------------------------------------------------------------------------
create table if not exists public.lead_whatsapp_dispatches (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  -- the sales person the lead was given to when the message was queued (the message introduces them)
  owner_id uuid references public.profiles (id) on delete set null,
  -- LEADWA|<lead>: one message per lead, ever
  dedupe_key text not null unique,
  recipient_masked text,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'DRY_RUN', 'ACCEPTED', 'DELIVERED', 'READ', 'RETRY', 'FAILED', 'SKIPPED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  provider_ref text check (length(provider_ref) <= 200),
  response_code integer,
  detail text check (length(detail) <= 500),
  requested_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_whatsapp_dispatches_customer_idx on public.lead_whatsapp_dispatches (customer_id);
create index if not exists lead_whatsapp_dispatches_ref_idx on public.lead_whatsapp_dispatches (provider_ref) where provider_ref is not null;
create index if not exists lead_whatsapp_dispatches_due_idx on public.lead_whatsapp_dispatches (next_attempt_at) where status in ('PENDING', 'RETRY');
create index if not exists lead_whatsapp_dispatches_recent_idx on public.lead_whatsapp_dispatches (created_at desc);
alter table public.lead_whatsapp_dispatches enable row level security;
revoke all on public.lead_whatsapp_dispatches from public, anon, authenticated;

create table if not exists public.lead_whatsapp_events (
  id bigint generated always as identity primary key,
  dispatch_id uuid not null references public.lead_whatsapp_dispatches (id) on delete cascade,
  kind text not null check (length(kind) <= 40),
  attempt integer,
  response_code integer,
  detail text check (length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists lead_whatsapp_events_dispatch_idx on public.lead_whatsapp_events (dispatch_id, id);
alter table public.lead_whatsapp_events enable row level security;
revoke all on public.lead_whatsapp_events from public, anon, authenticated;

create or replace function private.lead_wa_log(p_dispatch uuid, p_kind text, p_attempt integer default null, p_code integer default null, p_detail text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.lead_whatsapp_events (dispatch_id, kind, attempt, response_code, detail) values (p_dispatch, p_kind, p_attempt, p_code, left(p_detail, 500))
$$;
revoke all on function private.lead_wa_log(uuid, text, integer, integer, text) from public, anon, authenticated;

-- The lead's WhatsApp number (the WhatsApp number, else the phone), as ten digits; null when there is no valid Indian mobile number.
create or replace function private.lead_wa_number(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(private.mobile10(c.whatsapp), private.mobile10(c.phone)) from public.customers c where c.id = p_customer
$$;
revoke all on function private.lead_wa_number(uuid) from public, anon, authenticated;

-- Is this person a sales person a lead's welcome message may introduce? (see the header)
create or replace function private.lead_wa_is_seller(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_profile and p.status = 'ACTIVE'
       and (p.sales_sub_role = 'BUSINESS_ASSOCIATE'
            or (p.role in ('TEAM_MEMBER', 'TEAM_HEAD')
                and exists (select 1 from public.teams t where t.id = p.team_id and t.division::text = 'SALES'))))
$$;
revoke all on function private.lead_wa_is_seller(uuid) from public, anon, authenticated;

create or replace function private.lead_wa_json(d public.lead_whatsapp_dispatches)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'customerId', d.customer_id,
    'leadName', (select c.name from public.customers c where c.id = d.customer_id),
    'salesPerson', (select full_name from public.profiles where id = d.owner_id),
    'recipient', d.recipient_masked, 'status', d.status, 'attempts', d.attempts,
    'nextAttemptAt', case when d.status in ('PENDING', 'RETRY') then d.next_attempt_at end, 'detail', d.detail,
    'acceptedAt', d.accepted_at, 'deliveredAt', d.delivered_at, 'failedAt', d.failed_at, 'createdAt', d.created_at,
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'attempt', e.attempt, 'code', e.response_code, 'detail', e.detail, 'at', e.created_at) order by e.id)
                          from public.lead_whatsapp_events e where e.dispatch_id = d.id), '[]'::jsonb))
$$;
revoke all on function private.lead_wa_json(public.lead_whatsapp_dispatches) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The trigger: queue the message when a lead first reaches a sales person
-- ---------------------------------------------------------------------------
create or replace function private.lead_wa_enqueue(p_customer uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_enabled boolean;
  v_phone text;
  d public.lead_whatsapp_dispatches;
begin
  select enabled into v_enabled from public.lead_whatsapp_settings where id;
  if not coalesce(v_enabled, false) or p_owner is null or not private.lead_wa_is_seller(p_owner) then
    return;
  end if;
  v_phone := private.lead_wa_number(p_customer);
  insert into public.lead_whatsapp_dispatches (customer_id, owner_id, dedupe_key, recipient_masked, status, detail, requested_by)
  values (p_customer, p_owner, 'LEADWA|' || p_customer,
          case when v_phone is not null then '+91XXXXXX' || right(v_phone, 4) end,
          case when v_phone is null then 'SKIPPED' else 'PENDING' end,
          case when v_phone is null then 'NO_VALID_NUMBER: The lead has no valid WhatsApp or mobile number.' end,
          (select id from public.profiles where id = auth.uid()))
  on conflict (dedupe_key) do nothing
  returning * into d;
  if d.id is not null then
    perform private.lead_wa_log(d.id, case when d.status = 'SKIPPED' then 'SKIPPED' else 'QUEUED' end, null, null,
      case when d.status = 'SKIPPED' then d.detail else 'Queued when the lead was given to its first sales person' end);
    perform private.write_audit(case when d.status = 'SKIPPED' then 'LEAD_WHATSAPP_SKIPPED' else 'LEAD_WHATSAPP_QUEUED' end, 'customer', p_customer,
      (select department_id from public.customers where id = p_customer), (select team_id from public.customers where id = p_customer),
      jsonb_build_object('owner_id', p_owner));
  end if;
end $$;
revoke all on function private.lead_wa_enqueue(uuid, uuid) from public, anon, authenticated;

create or replace function private.lead_wa_after_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lifecycle_stage::text = 'LEAD' and new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    begin
      perform private.lead_wa_enqueue(new.id, new.owner_id);
    exception when others then
      -- a welcome message must never stop a lead from being saved
      raise warning 'lead welcome WhatsApp not queued for %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function private.lead_wa_after_owner() from public, anon, authenticated;

drop trigger if exists customers_lead_whatsapp on public.customers;
create trigger customers_lead_whatsapp after insert or update of owner_id on public.customers
  for each row execute function private.lead_wa_after_owner();

-- ---------------------------------------------------------------------------
-- 4. Settings: read and change (Super Admin or the Sales Department Head)
-- ---------------------------------------------------------------------------
create or replace function private.lead_wa_can_manage()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin() or private.is_sales_head()
$$;
revoke all on function private.lead_wa_can_manage() from public, anon;
grant execute on function private.lead_wa_can_manage() to authenticated, service_role;

create or replace function public.lead_whatsapp_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.lead_whatsapp_settings;
begin
  if not private.lead_wa_can_manage() then
    raise exception 'FORBIDDEN: Only the Super Admin or the Sales Department Head can see the lead WhatsApp settings.' using errcode = '42501';
  end if;
  select * into s from public.lead_whatsapp_settings where id;
  return jsonb_build_object('enabled', s.enabled, 'templateName', s.template_name, 'templateLanguage', s.template_language,
    'templateApproved', s.template_approved, 'variables', to_jsonb(s.variables), 'updatedAt', s.updated_at,
    'updatedBy', (select full_name from public.profiles where id = s.updated_by),
    'counts', (select jsonb_build_object(
                 'queued', count(*) filter (where status in ('PENDING', 'PROCESSING', 'RETRY')),
                 'sent', count(*) filter (where status in ('ACCEPTED', 'DELIVERED', 'READ')),
                 'failed', count(*) filter (where status = 'FAILED'),
                 'skipped', count(*) filter (where status = 'SKIPPED'),
                 'dryRun', count(*) filter (where status = 'DRY_RUN'))
                 from public.lead_whatsapp_dispatches),
    'recent', coalesce((select jsonb_agg(private.lead_wa_json(x) order by x.created_at desc)
                          from (select * from public.lead_whatsapp_dispatches order by created_at desc limit 20) x), '[]'::jsonb));
end $$;
revoke all on function public.lead_whatsapp_settings_get() from public, anon;
grant execute on function public.lead_whatsapp_settings_get() to authenticated;

create or replace function public.set_lead_whatsapp_settings(p_enabled boolean, p_template_name text, p_template_language text, p_template_approved boolean, p_variables text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.lead_whatsapp_settings;
  v_old public.lead_whatsapp_settings;
  v_name text := nullif(btrim(coalesce(p_template_name, '')), '');
  v_lang text := coalesce(nullif(btrim(coalesce(p_template_language, '')), ''), 'en');
  v_vars text[] := coalesce(p_variables, array[]::text[]);
begin
  if not private.lead_wa_can_manage() then
    raise exception 'FORBIDDEN: Only the Super Admin or the Sales Department Head can change the lead WhatsApp settings.' using errcode = '42501';
  end if;
  if p_enabled is null or p_template_approved is null then
    raise exception 'VALIDATION_ERROR: Choose on or off for each setting.' using errcode = 'P0001';
  end if;
  if v_name is not null and v_name !~ '^[a-z0-9_]{1,255}$' then
    raise exception 'VALIDATION_ERROR: The template name uses lower case letters, digits and underscores only, exactly as registered with the provider.' using errcode = 'P0001';
  end if;
  if v_lang !~ '^[a-z]{2}(_[A-Z]{2})?$' then
    raise exception 'VALIDATION_ERROR: The template language looks like en or en_US.' using errcode = 'P0001';
  end if;
  if cardinality(v_vars) > 10 or not (v_vars <@ array['LEAD_NAME', 'LEAD_COMPANY', 'SALES_PERSON_NAME', 'SALES_PERSON_PHONE']) then
    raise exception 'VALIDATION_ERROR: Each template variable is one of: lead name, lead company, sales person name, sales person phone (at most 10).' using errcode = 'P0001';
  end if;
  if p_template_approved and v_name is null then
    raise exception 'VALIDATION_ERROR: Enter the template name before marking it approved.' using errcode = 'P0001';
  end if;
  select * into v_old from public.lead_whatsapp_settings where id;
  -- A different template (name, language or variables) is a different, unapproved template: a save that changes an approved template
  -- withdraws the approval, and someone approves the new one in a later save.
  update public.lead_whatsapp_settings
     set enabled = p_enabled, template_name = v_name, template_language = v_lang, variables = v_vars,
         template_approved = p_template_approved and v_name is not null
                             and not (v_old.template_approved and (v_old.template_name is distinct from v_name
                                                                   or v_old.template_language <> v_lang or v_old.variables <> v_vars)),
         updated_by = auth.uid(), updated_at = now()
   where id returning * into s;
  perform private.write_audit('LEAD_WHATSAPP_SETTINGS_CHANGED', 'lead_whatsapp_settings', null, null, null,
    jsonb_build_object('enabled', s.enabled, 'template', s.template_name, 'language', s.template_language, 'approved', s.template_approved,
                       'variables', to_jsonb(s.variables), 'templateChanged', v_old.template_name is distinct from s.template_name));
  return public.lead_whatsapp_settings_get();
end $$;
revoke all on function public.set_lead_whatsapp_settings(boolean, text, text, boolean, text[]) from public, anon;
grant execute on function public.set_lead_whatsapp_settings(boolean, text, text, boolean, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A lead's message: history (anyone who can open the lead) and "Send again" (its sales person, their leads, the head, the Super Admin)
-- ---------------------------------------------------------------------------
create or replace function public.lead_whatsapp_history(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_customer(p_customer) then
    raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.lead_wa_json(d) order by d.created_at desc) from public.lead_whatsapp_dispatches d where d.customer_id = p_customer), '[]'::jsonb);
end $$;
revoke all on function public.lead_whatsapp_history(uuid) from public, anon;
grant execute on function public.lead_whatsapp_history(uuid) to authenticated;

create or replace function public.lead_whatsapp_resend(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.lead_whatsapp_dispatches;
  c public.customers;
  v_phone text;
begin
  if not private.can_access_customer(p_customer) then
    raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001';
  end if;
  select * into d from public.lead_whatsapp_dispatches where dedupe_key = 'LEADWA|' || p_customer for update;
  if d.id is null then
    raise exception 'CONFLICT: No welcome message was queued for this lead.' using errcode = 'P0001';
  end if;
  if d.status in ('PENDING', 'PROCESSING', 'RETRY') then
    return jsonb_build_object('requested', true, 'replayed', true, 'dispatch', private.lead_wa_json(d)); -- already on its way
  end if;
  if d.status in ('ACCEPTED', 'DELIVERED', 'READ') then
    raise exception 'CONFLICT: The welcome message was already sent to this lead.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  v_phone := private.lead_wa_number(p_customer);
  if v_phone is null then
    raise exception 'CONFLICT: The lead has no valid WhatsApp or mobile number. Add it to the lead and try again.' using errcode = 'P0001';
  end if;
  update public.lead_whatsapp_dispatches
     set status = 'PENDING', attempts = 0, next_attempt_at = now(), locked_until = null, detail = null,
         recipient_masked = '+91XXXXXX' || right(v_phone, 4), requested_by = auth.uid(), updated_at = now()
   where id = d.id returning * into d;
  perform private.lead_wa_log(d.id, 'RESEND_REQUESTED', null, null, 'Sent again');
  perform private.write_audit('LEAD_WHATSAPP_QUEUED', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('trigger', 'RESEND'));
  return jsonb_build_object('requested', true, 'replayed', false, 'dispatch', private.lead_wa_json(d));
end $$;
revoke all on function public.lead_whatsapp_resend(uuid) from public, anon;
grant execute on function public.lead_whatsapp_resend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The worker (service role): claim, finish, provider status reports
-- ---------------------------------------------------------------------------
create or replace function public.lead_whatsapp_claim(p_limit integer default 5, p_mode text default 'dry_run', p_lease_seconds integer default 300, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  s public.lead_whatsapp_settings;
  d public.lead_whatsapp_dispatches;
  c public.customers;
  v_ids uuid[] := '{}';
  v_why text;
begin
  if p_mode not in ('dry_run', 'live') then
    raise exception 'VALIDATION_ERROR: Unknown mode.' using errcode = 'P0001';
  end if;
  select * into s from public.lead_whatsapp_settings where id;

  -- A live attempt whose result was never recorded (the server stopped) is not repeated: it might have been sent.
  update public.lead_whatsapp_dispatches
     set status = case when p_mode = 'live' then 'FAILED' else 'PENDING' end,
         detail = case when p_mode = 'live' then 'The result of the last attempt was not recorded (the server stopped). It was not repeated so the lead is not sent it twice; check the provider and use "Send again".' else detail end,
         failed_at = case when p_mode = 'live' then v_now else failed_at end, locked_until = null, updated_at = v_now
   where status = 'PROCESSING' and locked_until < v_now;

  for d in
    select * from public.lead_whatsapp_dispatches x
     where x.status in ('PENDING', 'RETRY') and x.next_attempt_at <= v_now
     order by x.next_attempt_at, x.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  loop
    select * into c from public.customers where id = d.customer_id;
    v_why := case
      when not s.enabled then 'Lead welcome WhatsApp was switched off.'
      when private.lead_wa_number(d.customer_id) is null then 'NO_VALID_NUMBER: The lead has no valid WhatsApp or mobile number any more.'
    end;
    if v_why is not null then
      update public.lead_whatsapp_dispatches set status = 'SKIPPED', detail = v_why, locked_until = null, updated_at = v_now where id = d.id;
      perform private.lead_wa_log(d.id, 'SKIPPED', d.attempts, null, v_why);
      continue;
    end if;
    if p_mode = 'live' and (not s.template_approved or s.template_name is null) then
      continue; -- waits until the template is approved
    end if;
    update public.lead_whatsapp_dispatches set status = 'PROCESSING', attempts = d.attempts + 1,
           locked_until = v_now + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))), updated_at = v_now
     where id = d.id;
    perform private.lead_wa_log(d.id, 'ATTEMPT', d.attempts + 1, null, 'Claimed (' || p_mode || ')');
    v_ids := v_ids || d.id;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'attempts', x.attempts, 'customerId', c2.id,
             'leadName', c2.name, 'leadCompany', c2.company,
             -- the sales person the lead has NOW (it may have been reassigned since), else the one it was queued for
             'salesPersonName', coalesce(o.full_name, q.full_name), 'salesPersonPhone', coalesce(o.phone, q.phone),
             'to', '+91' || private.lead_wa_number(x.customer_id),
             'template', jsonb_build_object('name', s.template_name, 'language', s.template_language, 'approved', s.template_approved, 'variables', to_jsonb(s.variables))
           ) order by x.created_at)
      from public.lead_whatsapp_dispatches x
      join public.customers c2 on c2.id = x.customer_id
      left join public.profiles o on o.id = c2.owner_id and private.lead_wa_is_seller(o.id)
      left join public.profiles q on q.id = x.owner_id
     where x.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.lead_whatsapp_claim(integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.lead_whatsapp_claim(integer, text, integer, timestamptz) to service_role;

create or replace function public.lead_whatsapp_finish(p_dispatch uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_ref text default null, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.lead_whatsapp_dispatches;
  c public.customers;
  v_now timestamptz := coalesce(p_now, now());
  v_status text;
begin
  if p_outcome not in ('DRY_RUN', 'ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into d from public.lead_whatsapp_dispatches where id = p_dispatch for update;
  if d.id is null then
    raise exception 'NOT_FOUND: Dispatch not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PROCESSING' then
    raise exception 'CONFLICT: This dispatch is not being processed.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and d.attempts >= 3 then 'FAILED' else p_outcome end;
  update public.lead_whatsapp_dispatches
     set status = v_status, locked_until = null, response_code = p_response_code, updated_at = v_now,
         detail = case when v_status = 'ACCEPTED' then null else left(p_detail, 500) end,
         provider_ref = case when v_status = 'ACCEPTED' then left(p_ref, 200) else provider_ref end,
         accepted_at = case when v_status = 'ACCEPTED' then v_now else accepted_at end,
         failed_at = case when v_status = 'FAILED' then v_now else failed_at end,
         next_attempt_at = case when v_status = 'RETRY' then v_now + (array[10, 30])[least(d.attempts, 2)] * interval '1 minute' else next_attempt_at end
   where id = d.id returning * into d;
  perform private.lead_wa_log(d.id, v_status, d.attempts, p_response_code, p_detail);
  if v_status in ('ACCEPTED', 'FAILED', 'SKIPPED') then
    select * into c from public.customers where id = d.customer_id;
    perform private.write_audit('LEAD_WHATSAPP_' || v_status, 'customer', c.id, c.department_id, c.team_id,
      jsonb_build_object('attempts', d.attempts, 'detail', left(p_detail, 200)));
    if v_status <> 'SKIPPED' then
      perform private.log_customer_activity(c.id, 'LEAD_WHATSAPP_' || v_status,
        case when v_status = 'ACCEPTED' then 'Welcome WhatsApp about our services accepted by the sending service'
             else 'Welcome WhatsApp about our services could not be sent' end);
    end if;
  end if;
  return jsonb_build_object('status', v_status, 'attempts', d.attempts, 'nextAttemptAt', case when v_status = 'RETRY' then d.next_attempt_at end);
end $$;
revoke all on function public.lead_whatsapp_finish(uuid, text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.lead_whatsapp_finish(uuid, text, text, integer, text, timestamptz) to service_role;

-- The provider's delivery report, matched by its message reference. Only forward: ACCEPTED -> DELIVERED -> READ.
create or replace function public.lead_whatsapp_status_update(p_ref text, p_status text, p_detail text default null, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.lead_whatsapp_dispatches;
  v_now timestamptz := coalesce(p_now, now());
  v_status text := upper(coalesce(p_status, ''));
  v_rank jsonb := '{"ACCEPTED":1,"DELIVERED":2,"READ":3}';
begin
  if v_status not in ('DELIVERED', 'READ', 'FAILED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_ref, '')), '') is null then
    return jsonb_build_object('matched', false);
  end if;
  select * into d from public.lead_whatsapp_dispatches where provider_ref = left(p_ref, 200) order by created_at desc limit 1 for update;
  if d.id is null then
    return jsonb_build_object('matched', false);
  end if;
  if v_status = 'FAILED' then
    if d.status in ('DELIVERED', 'READ') then
      return jsonb_build_object('matched', true, 'status', d.status, 'ignored', true);
    end if;
    update public.lead_whatsapp_dispatches set status = 'FAILED', failed_at = v_now, detail = left(coalesce(p_detail, 'The message could not be delivered.'), 500), updated_at = v_now where id = d.id;
    perform private.lead_wa_log(d.id, 'DELIVERY_FAILED', d.attempts, null, p_detail);
    return jsonb_build_object('matched', true, 'status', 'FAILED');
  end if;
  if coalesce((v_rank ->> d.status)::int, 0) >= (v_rank ->> v_status)::int or d.status not in ('ACCEPTED', 'DELIVERED', 'READ') then
    return jsonb_build_object('matched', true, 'status', d.status, 'ignored', true);
  end if;
  update public.lead_whatsapp_dispatches set status = v_status, delivered_at = coalesce(delivered_at, v_now), detail = null, updated_at = v_now where id = d.id;
  perform private.lead_wa_log(d.id, v_status, d.attempts, null, null);
  return jsonb_build_object('matched', true, 'status', v_status);
end $$;
revoke all on function public.lead_whatsapp_status_update(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.lead_whatsapp_status_update(text, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
