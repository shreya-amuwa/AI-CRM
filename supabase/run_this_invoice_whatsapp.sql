-- Paste this whole file into the Supabase SQL editor and run it once (safe to run again).
-- Paid invoice by WhatsApp (Accounts): settings, one dispatch per invoice and number, history, delivery status. Nothing is sent by running this:
-- the server stays in dry run until AUTOMATION_MODE_INVOICE_WHATSAPP is live, Wabastore is connected and a template is approved in the invoice screen.
-- Needs the invoice migrations (20261028 and later) to be applied already.

-- ===== 20261129000100_invoice_whatsapp.sql =====
-- =============================================================================
-- Invoice by WhatsApp (Accounts)
--
-- The paid invoice (the PDF the CRM already draws, stores and e-mails) can also be sent to the customer's WhatsApp number through Wabastore.
-- Nothing here creates or changes an invoice: a dispatch only POINTS at an existing generated invoice whose paid PDF is stored, and all
-- figures in the message come from that stored invoice.
--
--   invoice_whatsapp_settings       one row: on/off, automatic sending after the paid invoice is ready, the approved template (name + language)
--   invoice_whatsapp_dispatches     one row per invoice + stage + recipient number (unique key = no duplicate, however often it is requested)
--   invoice_whatsapp_events         the history of each dispatch (requested, claimed, accepted, delivered, failed, retry ...)
--
-- A dispatch is: PENDING -> PROCESSING -> ACCEPTED (the provider took the request) -> DELIVERED -> READ (only when the provider reports it),
-- or RETRY (10 then 30 minutes later, 3 attempts) -> FAILED; DRY_RUN (decided, not sent) and SKIPPED (with the reason) also exist.
-- ACCEPTED is NOT delivered. A live send needs the template to be marked approved. A failed message never touches the invoice.
-- Re-runnable. Nothing is sent by this migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_whatsapp_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  auto_send boolean not null default false,
  -- the template as registered with the provider (Meta rules: lower case letters, digits and underscores)
  template_name text check (template_name is null or template_name ~ '^[a-z0-9_]{1,255}$'),
  template_language text not null default 'en' check (template_language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  -- set by a person who has checked that the provider has approved this template; a live send needs it
  template_approved boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.invoice_whatsapp_settings (id) values (true) on conflict (id) do nothing;
alter table public.invoice_whatsapp_settings enable row level security;
revoke all on public.invoice_whatsapp_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Dispatches and their history
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_whatsapp_dispatches (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.generated_invoices (invoice_id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  stage text not null default 'PAID' check (stage = 'PAID'),
  -- INVWA|invoice|stage|10-digit number: the same invoice to the same number exists once
  dedupe_key text not null unique,
  recipient_masked text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'DRY_RUN', 'ACCEPTED', 'DELIVERED', 'READ', 'RETRY', 'FAILED', 'SKIPPED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  provider_ref text check (length(provider_ref) <= 200),
  response_code integer,
  detail text check (length(detail) <= 500),
  trigger text not null default 'MANUAL' check (trigger in ('MANUAL', 'AUTO')),
  requested_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoice_whatsapp_dispatches_invoice_idx on public.invoice_whatsapp_dispatches (invoice_id, created_at desc);
create index if not exists invoice_whatsapp_dispatches_customer_idx on public.invoice_whatsapp_dispatches (customer_id);
create index if not exists invoice_whatsapp_dispatches_ref_idx on public.invoice_whatsapp_dispatches (provider_ref) where provider_ref is not null;
create index if not exists invoice_whatsapp_dispatches_due_idx on public.invoice_whatsapp_dispatches (next_attempt_at) where status in ('PENDING', 'RETRY');
alter table public.invoice_whatsapp_dispatches enable row level security;
revoke all on public.invoice_whatsapp_dispatches from public, anon, authenticated;

create table if not exists public.invoice_whatsapp_events (
  id bigint generated always as identity primary key,
  dispatch_id uuid not null references public.invoice_whatsapp_dispatches (id) on delete cascade,
  kind text not null check (length(kind) <= 40),
  attempt integer,
  response_code integer,
  detail text check (length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists invoice_whatsapp_events_dispatch_idx on public.invoice_whatsapp_events (dispatch_id, id);
alter table public.invoice_whatsapp_events enable row level security;
revoke all on public.invoice_whatsapp_events from public, anon, authenticated;

create or replace function private.invoice_wa_log(p_dispatch uuid, p_kind text, p_attempt integer default null, p_code integer default null, p_detail text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.invoice_whatsapp_events (dispatch_id, kind, attempt, response_code, detail) values (p_dispatch, p_kind, p_attempt, p_code, left(p_detail, 500))
$$;
revoke all on function private.invoice_wa_log(uuid, text, integer, integer, text) from public, anon, authenticated;

-- The customer's WhatsApp number as the CRM holds it (the WhatsApp number, else the mobile number), as ten digits; null when there is no valid one.
create or replace function private.invoice_wa_number(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(private.mobile10(c.whatsapp), private.mobile10(c.phone)) from public.customers c where c.id = p_customer
$$;
revoke all on function private.invoice_wa_number(uuid) from public, anon, authenticated;

create or replace function private.invoice_wa_json(d public.invoice_whatsapp_dispatches)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'invoiceId', d.invoice_id, 'stage', d.stage, 'recipient', d.recipient_masked, 'status', d.status, 'attempts', d.attempts,
    'nextAttemptAt', case when d.status in ('PENDING', 'RETRY') then d.next_attempt_at end, 'detail', d.detail, 'trigger', d.trigger,
    'requestedBy', (select full_name from public.profiles where id = d.requested_by), 'acceptedAt', d.accepted_at, 'deliveredAt', d.delivered_at,
    'failedAt', d.failed_at, 'createdAt', d.created_at,
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'attempt', e.attempt, 'code', e.response_code, 'detail', e.detail, 'at', e.created_at) order by e.id)
                          from public.invoice_whatsapp_events e where e.dispatch_id = d.id), '[]'::jsonb))
$$;
revoke all on function private.invoice_wa_json(public.invoice_whatsapp_dispatches) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Settings: read (Accounts) and change (Super Admin or the Accounts Department Head)
-- ---------------------------------------------------------------------------
create or replace function public.invoice_whatsapp_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.invoice_whatsapp_settings;
begin
  perform private.require_accounts_staff();
  select * into s from public.invoice_whatsapp_settings where id;
  return jsonb_build_object('enabled', s.enabled, 'autoSend', s.auto_send, 'templateName', s.template_name, 'templateLanguage', s.template_language,
    'templateApproved', s.template_approved, 'updatedAt', s.updated_at,
    'canEdit', private.is_super_admin() or exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                                                    where p.id = auth.uid() and p.status = 'ACTIVE' and d.slug = 'accounts' and p.role = 'DEPARTMENT_HEAD'));
end $$;
revoke all on function public.invoice_whatsapp_settings_get() from public, anon;
grant execute on function public.invoice_whatsapp_settings_get() to authenticated;

create or replace function public.set_invoice_whatsapp_settings(p_enabled boolean, p_auto_send boolean, p_template_name text, p_template_language text, p_template_approved boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.invoice_whatsapp_settings;
  v_name text := nullif(btrim(coalesce(p_template_name, '')), '');
  v_lang text := coalesce(nullif(btrim(coalesce(p_template_language, '')), ''), 'en');
  v_old public.invoice_whatsapp_settings;
begin
  if not (private.is_super_admin() or exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                                               where p.id = auth.uid() and p.status = 'ACTIVE' and d.slug = 'accounts' and p.role = 'DEPARTMENT_HEAD')) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Accounts Department Head can change the invoice WhatsApp settings.' using errcode = '42501';
  end if;
  if p_enabled is null or p_auto_send is null or p_template_approved is null then
    raise exception 'VALIDATION_ERROR: Choose on or off for each setting.' using errcode = 'P0001';
  end if;
  if v_name is not null and v_name !~ '^[a-z0-9_]{1,255}$' then
    raise exception 'VALIDATION_ERROR: The template name uses lower case letters, digits and underscores only, exactly as registered with the provider.' using errcode = 'P0001';
  end if;
  if v_lang !~ '^[a-z]{2}(_[A-Z]{2})?$' then
    raise exception 'VALIDATION_ERROR: The template language looks like en or en_US.' using errcode = 'P0001';
  end if;
  if p_template_approved and v_name is null then
    raise exception 'VALIDATION_ERROR: Enter the template name before marking it approved.' using errcode = 'P0001';
  end if;
  select * into v_old from public.invoice_whatsapp_settings where id;
  -- a different template is a different (unapproved) template until someone approves it again
  update public.invoice_whatsapp_settings
     set enabled = p_enabled, auto_send = p_auto_send and p_enabled, template_name = v_name, template_language = v_lang,
         template_approved = p_template_approved and v_name is not null, updated_by = auth.uid(), updated_at = now()
   where id returning * into s;
  perform private.write_audit('INVOICE_WHATSAPP_SETTINGS_CHANGED', 'invoice_whatsapp_settings', null, null, null,
    jsonb_build_object('enabled', s.enabled, 'autoSend', s.auto_send, 'template', s.template_name, 'language', s.template_language, 'approved', s.template_approved,
                       'templateChanged', v_old.template_name is distinct from s.template_name));
  return public.invoice_whatsapp_settings_get();
end $$;
revoke all on function public.set_invoice_whatsapp_settings(boolean, boolean, text, text, boolean) from public, anon;
grant execute on function public.set_invoice_whatsapp_settings(boolean, boolean, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Request (Accounts): idempotent
-- ---------------------------------------------------------------------------
-- One click, a repeated click, a retried request and a repeated automation event all land here and all end in the same row (unique key).
-- A manual request that cannot be made says why (an error); an automatic one that cannot be made returns requested = false and a reason.
create or replace function public.accounts_invoice_whatsapp_request(p_invoice uuid, p_stage text default 'PAID', p_trigger text default 'MANUAL', p_resend boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  s public.invoice_whatsapp_settings;
  d public.invoice_whatsapp_dispatches;
  v_trigger text := upper(coalesce(p_trigger, 'MANUAL'));
  v_phone text;
  v_key text;
  v_why text;
  v_replayed boolean := false;
begin
  perform private.require_accounts_staff();
  if upper(coalesce(p_stage, '')) <> 'PAID' or v_trigger not in ('MANUAL', 'AUTO') then
    raise exception 'VALIDATION_ERROR: Only the paid invoice is sent by WhatsApp.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = p_invoice for update;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into s from public.invoice_whatsapp_settings where id;
  v_phone := private.invoice_wa_number(g.customer_id);
  v_why := case
    when not s.enabled then 'Invoice WhatsApp is switched off. Switch it on in the invoice WhatsApp settings first.'
    when g.lifecycle <> 'PAID' then 'The payment is not confirmed yet, so there is no paid invoice to send.'
    when g.paid_pdf_status <> 'STORED' then 'The paid invoice PDF is not ready yet. Finish "Send paid invoice" first.'
    when v_phone is null then 'The customer has no valid WhatsApp or mobile number. Add it to the customer and try again.'
  end;
  if v_why is not null then
    if v_trigger = 'AUTO' then
      return jsonb_build_object('requested', false, 'reason', v_why);
    end if;
    raise exception 'CONFLICT: %', v_why using errcode = 'P0001';
  end if;

  v_key := format('INVWA|%s|PAID|%s', g.invoice_id, v_phone);
  select * into d from public.invoice_whatsapp_dispatches where dedupe_key = v_key for update;
  if d.id is null then
    insert into public.invoice_whatsapp_dispatches (invoice_id, customer_id, stage, dedupe_key, recipient_masked, trigger, requested_by)
    values (g.invoice_id, g.customer_id, 'PAID', v_key, '+91XXXXXX' || right(v_phone, 4), v_trigger, auth.uid())
    returning * into d;
    perform private.invoice_wa_log(d.id, 'REQUESTED', null, null, case when v_trigger = 'AUTO' then 'Requested automatically after the paid invoice was ready' else 'Requested by Accounts' end);
    perform private.write_audit('INVOICE_WHATSAPP_REQUESTED', 'invoice', g.invoice_id, (select department_id from public.customers where id = g.customer_id),
      (select team_id from public.customers where id = g.customer_id), jsonb_build_object('customer_id', g.customer_id, 'number', g.invoice_number, 'trigger', v_trigger));
  else
    v_replayed := true;
    if p_resend and v_trigger = 'MANUAL' then
      if d.status in ('DELIVERED', 'READ') then
        raise exception 'CONFLICT: This invoice was already delivered to this WhatsApp number.' using errcode = 'P0001';
      elsif d.status in ('PENDING', 'PROCESSING', 'RETRY') then
        null; -- already on its way
      elsif d.status = 'ACCEPTED' and d.accepted_at > now() - interval '30 minutes' then
        raise exception 'CONFLICT: The message was accepted a moment ago. Wait for the delivery report before sending it again.' using errcode = 'P0001';
      else
        update public.invoice_whatsapp_dispatches
           set status = 'PENDING', attempts = 0, next_attempt_at = now(), locked_until = null, detail = null, requested_by = auth.uid(), trigger = 'MANUAL', updated_at = now()
         where id = d.id returning * into d;
        v_replayed := false;
        perform private.invoice_wa_log(d.id, 'RESEND_REQUESTED', null, null, 'Sent again by Accounts');
        perform private.write_audit('INVOICE_WHATSAPP_REQUESTED', 'invoice', g.invoice_id, (select department_id from public.customers where id = g.customer_id),
          (select team_id from public.customers where id = g.customer_id), jsonb_build_object('customer_id', g.customer_id, 'number', g.invoice_number, 'trigger', 'RESEND'));
      end if;
    end if;
  end if;
  return jsonb_build_object('requested', true, 'replayed', v_replayed, 'dispatch', private.invoice_wa_json(d));
end $$;
revoke all on function public.accounts_invoice_whatsapp_request(uuid, text, text, boolean) from public, anon;
grant execute on function public.accounts_invoice_whatsapp_request(uuid, text, text, boolean) to authenticated;

create or replace function public.accounts_invoice_whatsapp_history(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return coalesce((select jsonb_agg(private.invoice_wa_json(d) order by d.created_at desc) from public.invoice_whatsapp_dispatches d where d.invoice_id = p_invoice), '[]'::jsonb);
end $$;
revoke all on function public.accounts_invoice_whatsapp_history(uuid) from public, anon;
grant execute on function public.accounts_invoice_whatsapp_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The worker (service role): claim, finish, provider status reports
-- ---------------------------------------------------------------------------
-- p_dispatch: process exactly that dispatch (the one a click just requested). p_mode dry_run claims even without approved wording; live needs it.
create or replace function public.invoice_whatsapp_claim(p_limit integer default 5, p_mode text default 'dry_run', p_lease_seconds integer default 300, p_now timestamptz default null, p_dispatch uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  s public.invoice_whatsapp_settings;
  d public.invoice_whatsapp_dispatches;
  g public.generated_invoices;
  v_ids uuid[] := '{}';
  v_why text;
  v_phone text;
begin
  if p_mode not in ('dry_run', 'live') then
    raise exception 'VALIDATION_ERROR: Unknown mode.' using errcode = 'P0001';
  end if;
  select * into s from public.invoice_whatsapp_settings where id;

  -- A live attempt whose result was never recorded (the server stopped) is not repeated: it might have been sent.
  update public.invoice_whatsapp_dispatches
     set status = case when p_mode = 'live' then 'FAILED' else 'PENDING' end,
         detail = case when p_mode = 'live' then 'The result of the last attempt was not recorded (the server stopped). It was not repeated so the customer is not sent it twice; check the provider and use "Send again".' else detail end,
         failed_at = case when p_mode = 'live' then v_now else failed_at end, locked_until = null, updated_at = v_now
   where status = 'PROCESSING' and locked_until < v_now;

  for d in
    select * from public.invoice_whatsapp_dispatches x
     where x.status in ('PENDING', 'RETRY') and x.next_attempt_at <= v_now and (p_dispatch is null or x.id = p_dispatch)
     order by x.next_attempt_at, x.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  loop
    select * into g from public.generated_invoices where invoice_id = d.invoice_id;
    v_phone := private.invoice_wa_number(d.customer_id);
    v_why := case
      when g.lifecycle <> 'PAID' or g.paid_pdf_status <> 'STORED' then 'The paid invoice is not ready.'
      when v_phone is null then 'The customer has no valid WhatsApp or mobile number any more.'
      when d.dedupe_key <> format('INVWA|%s|PAID|%s', g.invoice_id, v_phone) then 'The customer''s number changed after this was requested. Send it again to the new number.'
      when not s.enabled then 'Invoice WhatsApp was switched off.'
    end;
    if v_why is not null then
      update public.invoice_whatsapp_dispatches set status = 'SKIPPED', detail = v_why, locked_until = null, updated_at = v_now where id = d.id;
      perform private.invoice_wa_log(d.id, 'SKIPPED', d.attempts, null, v_why);
      continue;
    end if;
    if p_mode = 'live' and (not s.template_approved or s.template_name is null) then
      continue; -- waits until the template is approved
    end if;
    update public.invoice_whatsapp_dispatches set status = 'PROCESSING', attempts = d.attempts + 1, locked_until = v_now + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))), updated_at = v_now
     where id = d.id;
    perform private.invoice_wa_log(d.id, 'ATTEMPT', d.attempts + 1, null, 'Claimed (' || p_mode || ')');
    v_ids := v_ids || d.id;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'attempts', x.attempts, 'invoiceId', g2.invoice_id, 'customerId', g2.customer_id, 'number', g2.invoice_number, 'invoiceDate', g2.invoice_date,
             'total', g2.total_amount, 'customerName', coalesce(nullif(btrim(g2.business_name), ''), g2.customer_name),
             'to', '+91' || private.invoice_wa_number(x.customer_id),
             'file', jsonb_build_object('provider', g2.paid_storage_provider, 'bucket', g2.paid_storage_bucket, 'path', g2.paid_storage_path,
                                        'sizeBytes', g2.paid_size_bytes, 'etag', g2.paid_storage_etag),
             'template', jsonb_build_object('name', s.template_name, 'language', s.template_language, 'approved', s.template_approved)) order by x.created_at)
      from public.invoice_whatsapp_dispatches x join public.generated_invoices g2 on g2.invoice_id = x.invoice_id
     where x.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.invoice_whatsapp_claim(integer, text, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.invoice_whatsapp_claim(integer, text, integer, timestamptz, uuid) to service_role;

create or replace function public.invoice_whatsapp_finish(p_dispatch uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_ref text default null, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.invoice_whatsapp_dispatches;
  g public.generated_invoices;
  c public.customers;
  v_now timestamptz := coalesce(p_now, now());
  v_status text;
begin
  if p_outcome not in ('DRY_RUN', 'ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into d from public.invoice_whatsapp_dispatches where id = p_dispatch for update;
  if d.id is null then
    raise exception 'NOT_FOUND: Dispatch not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PROCESSING' then
    raise exception 'CONFLICT: This dispatch is not being processed.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and d.attempts >= 3 then 'FAILED' else p_outcome end;
  update public.invoice_whatsapp_dispatches
     set status = v_status, locked_until = null, response_code = p_response_code, updated_at = v_now,
         detail = case when v_status = 'ACCEPTED' then null else left(p_detail, 500) end,
         provider_ref = case when v_status = 'ACCEPTED' then left(p_ref, 200) else provider_ref end,
         accepted_at = case when v_status = 'ACCEPTED' then v_now else accepted_at end,
         failed_at = case when v_status = 'FAILED' then v_now else failed_at end,
         next_attempt_at = case when v_status = 'RETRY' then v_now + (array[10, 30])[least(d.attempts, 2)] * interval '1 minute' else next_attempt_at end
   where id = d.id returning * into d;
  perform private.invoice_wa_log(d.id, case when v_status = 'ACCEPTED' then 'ACCEPTED' when v_status = 'DRY_RUN' then 'DRY_RUN' when v_status = 'RETRY' then 'RETRY'
                                            when v_status = 'SKIPPED' then 'SKIPPED' else 'FAILED' end, d.attempts, p_response_code, p_detail);
  if v_status in ('ACCEPTED', 'FAILED') then
    select * into g from public.generated_invoices where invoice_id = d.invoice_id;
    select * into c from public.customers where id = d.customer_id;
    perform private.write_audit(case when v_status = 'ACCEPTED' then 'INVOICE_WHATSAPP_ACCEPTED' else 'INVOICE_WHATSAPP_FAILED' end, 'invoice', d.invoice_id, c.department_id, c.team_id,
      jsonb_build_object('customer_id', c.id, 'number', g.invoice_number, 'attempts', d.attempts, 'detail', left(p_detail, 200)));
    perform private.log_customer_activity(c.id, 'INVOICE_WHATSAPP_' || v_status,
      format('Paid invoice %s %s by WhatsApp', g.invoice_number, case when v_status = 'ACCEPTED' then 'accepted by the sending service' else 'could not be sent' end));
  end if;
  return jsonb_build_object('status', v_status, 'attempts', d.attempts, 'nextAttemptAt', case when v_status = 'RETRY' then d.next_attempt_at end);
end $$;
revoke all on function public.invoice_whatsapp_finish(uuid, text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.invoice_whatsapp_finish(uuid, text, text, integer, text, timestamptz) to service_role;

-- The provider's delivery report, matched by its message reference. Only forward: ACCEPTED -> DELIVERED -> READ; a late "accepted" never downgrades.
create or replace function public.invoice_whatsapp_status_update(p_ref text, p_status text, p_detail text default null, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.invoice_whatsapp_dispatches;
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
  select * into d from public.invoice_whatsapp_dispatches where provider_ref = left(p_ref, 200) order by created_at desc limit 1 for update;
  if d.id is null then
    return jsonb_build_object('matched', false);
  end if;
  if v_status = 'FAILED' then
    if d.status in ('DELIVERED', 'READ') then
      return jsonb_build_object('matched', true, 'status', d.status, 'ignored', true);
    end if;
    update public.invoice_whatsapp_dispatches set status = 'FAILED', failed_at = v_now, detail = left(coalesce(p_detail, 'The message could not be delivered.'), 500), updated_at = v_now where id = d.id;
    perform private.invoice_wa_log(d.id, 'DELIVERY_FAILED', d.attempts, null, p_detail);
    return jsonb_build_object('matched', true, 'status', 'FAILED');
  end if;
  if coalesce((v_rank ->> d.status)::int, 0) >= (v_rank ->> v_status)::int then
    return jsonb_build_object('matched', true, 'status', d.status, 'ignored', true);
  end if;
  update public.invoice_whatsapp_dispatches set status = v_status, delivered_at = coalesce(delivered_at, v_now), detail = null, updated_at = v_now where id = d.id;
  perform private.invoice_wa_log(d.id, v_status, d.attempts, null, null);
  return jsonb_build_object('matched', true, 'status', v_status);
end $$;
revoke all on function public.invoice_whatsapp_status_update(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.invoice_whatsapp_status_update(text, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
