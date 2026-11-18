-- =============================================================================
-- Attendance reminders: a browser that renews its push subscription keeps getting the same person's reminders.
--
-- Browsers sometimes replace a push subscription on their own (new address and keys). The CRM's service worker then sends the old and
-- the new subscription to the API with nobody signed in (it runs in the background). This moves an existing, active device to its new
-- address, for the same person. Nothing else: an unknown or switched-off device, or an address another device already has, changes
-- nothing. Service role only (the API).
--
-- And push_subscription_claim: a browser that is already subscribed is claimed by whoever is signed in on it now (a shared phone whose
-- last user's session simply expired follows the person using it). Unlike push_subscription_save it never creates a row, so a device the
-- person removed from their list is not brought back by the next page load; the browser then unsubscribes itself.
-- Safe to run twice; pasteable in the SQL editor.
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

create or replace function public.push_subscription_claim(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.push_subscriptions;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  select * into r from public.push_subscriptions where endpoint = p_endpoint for update;
  if r.id is null then
    return false;
  end if;
  if r.profile_id is distinct from me.id then
    update public.push_subscriptions
       set profile_id = me.id, p256dh = coalesce(nullif(p_p256dh, ''), p256dh), auth = coalesce(nullif(p_auth, ''), auth),
           label = coalesce(left(nullif(trim(p_label), ''), 120), label), active = true, created_at = clock_timestamp()
     where id = r.id;
    perform private.write_audit('PUSH_DEVICE_ADDED', 'push_subscription', r.id, me.department_id, me.team_id,
      jsonb_build_object('label', left(nullif(trim(p_label), ''), 120), 'movedFromAnotherPerson', true));
  end if;
  return true;
end $$;
revoke all on function public.push_subscription_claim(text, text, text, text) from public, anon;
grant execute on function public.push_subscription_claim(text, text, text, text) to authenticated;
