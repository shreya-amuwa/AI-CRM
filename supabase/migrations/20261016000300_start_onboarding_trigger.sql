-- =============================================================================
-- Onboarding messages start when the Technical Consultant clicks "Send for onboarding"
-- (Start onboarding), not when the customer merely reaches the consultant.
--
-- Why: a customer reaches the consultant (and can come back) before the consultant has
-- talked to them about add-ons. The first email + WhatsApp now go out once, when the
-- consultant starts onboarding, whether or not the customer wants add-on services.
-- Adding add-ons later never sends the onboarding messages again (each step is still sent
-- once per channel, forward only).
--
-- Also: a stricter website check (a real web address with a proper domain).
-- Additive / re-runnable.
-- =============================================================================

-- 1. The stage is decided from "the consultant started onboarding" instead of "reached the consultant".
create or replace function private.client_status_target(p_customer uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
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
  -- every document / detail sales collected is authorized (the WABA ID comes later, at completion)
  if o.returned_at is null and o.items_total > 0 and o.items_verified >= o.items_total and o.items_rejected = 0 and v_has_site then
    return 'META_VERIFICATION';
  end if;
  return case when v_has_site then 'UNDER_REVIEW' else 'WEBSITE_PENDING' end;
end $$;
revoke all on function private.client_status_target(uuid) from public, anon, authenticated;

-- 2. Customers whose step was only recorded when they reached the consultant, with no message ever
--    queued and onboarding not started yet, wait for "Send for onboarding" like everyone else.
update public.customer_onboarding o
   set client_status = null, client_status_changed_at = null
 where o.client_status is not null
   and o.consultant_started_at is null
   and not exists (select 1 from public.automation_jobs j where j.customer_id = o.customer_id);

-- 3. Customers that already started onboarding: the step is recorded now if it was missing
--    (silently: no message for work that already happened; the consultant can press "Send ... messages").
do $$
declare
  r record;
begin
  for r in select o.customer_id from public.customer_onboarding o
            where o.client_status is null and o.consultant_started_at is not null
  loop
    perform private.advance_client_status(r.customer_id, true);
  end loop;
end $$;

-- 4. Website: a proper domain (letters in the ending, no spaces, not "a" or an IP address).
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
  if length(v) > 500
     or v !~* '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
    raise exception 'VALIDATION_ERROR: Enter the website address (for example https://www.example.com), or tick "Customer has no website".' using errcode = 'P0001';
  end if;
  new.value := v;
  return new;
end $$;
revoke all on function private.tg_onboarding_entries_website() from public, anon, authenticated;
