-- =============================================================================
-- 1. An invoice for the customer's original services becomes Paid by itself once the verified
--    payments cover the agreed amount (it used to stay "Pending" until Accounts clicked
--    "Mark as paid", even when Accounts had already verified the full payment).
-- 2. "Your mini website is ready": when the Technical Consultant authorizes the website link of a
--    customer who started without a website, the customer gets an email + WhatsApp with the link.
--
-- Additive / re-runnable. Existing invoices and messages are kept.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Invoice status follows the verified payments
-- ---------------------------------------------------------------------------
-- Who set the status last: the system (AUTO) or an Accounts person (MANUAL). A status Accounts set
-- by hand is never changed by the system.
alter table public.member_invoices add column if not exists status_source text;
do $$
begin
  alter table public.member_invoices add constraint member_invoices_status_source_check check (status_source in ('AUTO', 'MANUAL'));
exception when duplicate_object then null;
end $$;

-- Paid when the verified payments cover the agreed amount, Pending again when a verified payment is
-- reversed. Only invoices for the original services (not add-on invoices, which follow their own
-- payment confirmation) and only those not set by hand.
create or replace function private.sync_invoice_payment_status(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_covered boolean;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null then
    return;
  end if;
  v_covered := coalesce(c.deal_amount, 0) > 0 and coalesce(c.amount_verified, 0) >= c.deal_amount;
  if v_covered then
    update public.member_invoices
       set status = 'Paid', paid_at = coalesce(paid_at, now()), status_source = 'AUTO'
     where customer_id = p_customer and kind in ('SERVICE', 'UPLOADED') and addon_request_id is null
       and status = 'Pending' and status_source is distinct from 'MANUAL';
  else
    update public.member_invoices
       set status = 'Pending', paid_at = null
     where customer_id = p_customer and kind in ('SERVICE', 'UPLOADED') and addon_request_id is null
       and status = 'Paid' and status_source = 'AUTO';
  end if;
end $$;
revoke all on function private.sync_invoice_payment_status(uuid) from public, anon, authenticated;

-- Every change to the customer's verified money passes through here.
create or replace function private.sync_payment_totals(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recorded numeric;
  v_verified numeric;
begin
  select coalesce(sum(amount) filter (where status in ('PENDING', 'VERIFIED')), 0),
         coalesce(sum(amount) filter (where status = 'VERIFIED'), 0)
    into v_recorded, v_verified
    from public.customer_payments where customer_id = p_customer;
  update public.customers set amount_received = v_recorded, amount_verified = v_verified where id = p_customer;
  update public.customer_onboarding set payment_verified = v_verified > 0 where customer_id = p_customer;
  perform private.sync_invoice_payment_status(p_customer);
end $$;
revoke all on function private.sync_payment_totals(uuid) from public, anon, authenticated;

-- An invoice uploaded after the payment was verified is Paid from the start.
create or replace function private.tg_invoice_payment_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_invoice_payment_status(new.customer_id);
  return null;
end $$;
revoke all on function private.tg_invoice_payment_status() from public, anon, authenticated;
drop trigger if exists member_invoices_payment_status on public.member_invoices;
create trigger member_invoices_payment_status after insert on public.member_invoices
  for each row when (new.customer_id is not null and new.kind in ('SERVICE', 'UPLOADED') and new.addon_request_id is null)
  execute function private.tg_invoice_payment_status();

-- A status Accounts sets by hand stays as set.
create or replace function public.accounts_set_invoice_status(p_invoice uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
begin
  perform private.require_accounts_staff();
  if p_status is null or p_status not in ('Paid', 'Pending') then
    raise exception 'VALIDATION_ERROR: Choose paid or pending.' using errcode = 'P0001';
  end if;
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if inv.kind = 'ADDON' or inv.addon_request_id is not null then
    raise exception 'CONFLICT: An add-on invoice is marked paid when Accounts confirms the add-on payment.' using errcode = 'P0001';
  end if;
  update public.member_invoices
     set status = p_status, status_source = 'MANUAL', paid_at = case when p_status = 'Paid' then coalesce(paid_at, now()) end
   where id = p_invoice returning * into inv;
  perform private.write_audit('INVOICE_STATUS_CHANGED', 'invoice', inv.id, inv.department_id, null,
    jsonb_build_object('number', inv.invoice_number, 'status', p_status));
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_set_invoice_status(uuid, text) from public, anon;
grant execute on function public.accounts_set_invoice_status(uuid, text) to authenticated;

-- Invoices that already exist for customers whose payments are fully verified.
do $$
declare
  r record;
begin
  for r in select distinct i.customer_id from public.member_invoices i where i.customer_id is not null loop
    perform private.sync_invoice_payment_status(r.customer_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. "Your mini website is ready" (email + WhatsApp)
-- ---------------------------------------------------------------------------
alter table public.automation_jobs drop constraint if exists automation_jobs_stage_check;
alter table public.automation_jobs add constraint automation_jobs_stage_check
  check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED', 'WEBSITE_READY'));

-- Meta Verification needs the website link to be a real address AND authorized by the consultant,
-- on top of every required document / detail being authorized.
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
    return null; -- the consultant has not started onboarding yet
  end if;
  v_has_site := v_site is not null and v_site <> 'NO_WEBSITE';
  if exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer) then
    return 'COMPLETED';
  end if;
  select * into e from public.customer_onboarding_entries where customer_id = p_customer and item_code = 'WA_WEBSITE_URL';
  if o.returned_at is null and o.items_total > 0 and o.items_verified >= o.items_total and o.items_rejected = 0
     and v_has_site and e.status = 'VERIFIED' then
    return 'META_VERIFICATION';
  end if;
  return case when v_has_site then 'UNDER_REVIEW' else 'WEBSITE_PENDING' end;
end $$;
revoke all on function private.client_status_target(uuid) from public, anon, authenticated;

-- The consultant saves (or corrects) the website link. It is a normal entry: it waits for the
-- consultant's "Authorize", like every other detail.
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
  insert into public.customer_onboarding_entries as x (customer_id, item_code, value, status, saved_by, saved_at)
  values (p_customer, 'WA_WEBSITE_URL', p_url, 'SAVED', (select private.my_id()), now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, status = 'SAVED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = null, reviewed_at = null, review_note = null
  returning * into e;
  perform private.refresh_onboarding_progress(p_customer);
  perform private.log_customer_activity(p_customer, 'WEBSITE_SAVED', format('Website saved by the Technical Consultant: %s', e.value));
  perform private.write_audit('ONBOARDING_WEBSITE_SAVED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('website', e.value));
  return e.value;
end $$;
revoke all on function public.consultant_set_website(uuid, text) from public, anon;
grant execute on function public.consultant_set_website(uuid, text) to authenticated;

-- Queues the "website is ready" email + WhatsApp (once per channel). Only for a customer that
-- started without a website (our team built it), once onboarding has started, and only when the
-- website link is a real address that the consultant authorized.
create or replace function private.queue_website_ready(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.customer_onboarding_entries;
  ch text;
  v_new boolean := false;
begin
  if not private.automation_eligible(p_customer) then
    return;
  end if;
  select * into e from public.customer_onboarding_entries where customer_id = p_customer and item_code = 'WA_WEBSITE_URL';
  if e.customer_id is null or e.status <> 'VERIFIED' or e.value is null or e.value = 'NO_WEBSITE' then
    return;
  end if;
  if not exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer
                  and o.consultant_started_at is not null and o.returned_at is null) then
    return;
  end if;
  -- started without a website: the "Website Pending" messages were queued for this customer
  if not exists (select 1 from public.automation_jobs j where j.customer_id = p_customer and j.stage = 'WEBSITE_PENDING') then
    return;
  end if;
  foreach ch in array array['EMAIL', 'WHATSAPP'] loop
    -- a second earlier than "now": when authorizing this link also completes the checklist, the
    -- customer gets "website ready" before "Meta Verification"
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, created_by, next_attempt_at)
    values (p_customer, ch, 'WEBSITE_READY', format('ONBOARD|%s|%s|WEBSITE_READY', p_customer, ch), '{}'::jsonb,
            (select private.my_id()), now() - interval '1 second')
    on conflict (dedupe_key) do nothing;
    v_new := v_new or found;
  end loop;
  if v_new then
    perform private.log_customer_activity(p_customer, 'WEBSITE_READY', 'Website authorized - "website ready" email and WhatsApp queued');
  end if;
end $$;
revoke all on function private.queue_website_ready(uuid) from public, anon, authenticated;

create or replace function private.tg_website_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_website_ready(new.customer_id);
  return null;
end $$;
revoke all on function private.tg_website_ready() from public, anon, authenticated;

-- Named so that it runs before the stage trigger (triggers run in name order).
drop trigger if exists onboarding_entries_a_website_ready on public.customer_onboarding_entries;
create trigger onboarding_entries_a_website_ready after insert or update on public.customer_onboarding_entries
  for each row when (new.item_code = 'WA_WEBSITE_URL' and new.status = 'VERIFIED')
  execute function private.tg_website_ready();
