-- =============================================================================
-- Attendance reminders: a browser that renews its push subscription keeps getting the same person's reminders.
--
-- Browsers sometimes replace a push subscription on their own (new address and keys). The CRM's service worker then sends the old and
-- the new subscription to the API with nobody signed in (it runs in the background). This moves an existing, active device to its new
-- address, for the same person. Nothing else: an unknown or switched-off device, or an address another device already has, changes
-- nothing. Service role only (the API). Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

create or replace function public.push_subscription_replace(p_old_endpoint text, p_new_endpoint text, p_p256dh text, p_auth text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_new_endpoint is null or p_new_endpoint !~ '^https://' or length(p_new_endpoint) > 1000
     or coalesce(length(p_p256dh), 0) not between 1 and 200 or coalesce(length(p_auth), 0) not between 1 and 100 then
    raise exception 'VALIDATION_ERROR: The renewed subscription is not valid.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.push_subscriptions where endpoint = p_new_endpoint) then
    return false;
  end if;
  update public.push_subscriptions
     set endpoint = p_new_endpoint, p256dh = p_p256dh, auth = p_auth, last_failure_at = null
   where endpoint = p_old_endpoint and active
  returning id into v_id;
  return v_id is not null;
exception when unique_violation then
  return false;   -- the same new address saved at the same moment by another request
end $$;
revoke all on function public.push_subscription_replace(text, text, text, text) from public, anon, authenticated;
grant execute on function public.push_subscription_replace(text, text, text, text) to service_role;
