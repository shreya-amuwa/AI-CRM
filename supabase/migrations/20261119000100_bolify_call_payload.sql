-- =============================================================================
-- BolifyAI calls: the reminder the sender takes also carries the customer's e-mail and city (their "location").
--
-- BolifyAI starts a call from a webhook that takes { name, phone, email, service, location } (the same fields the Google Sheet script
-- posted). The claim now returns the customer's e-mail and city with each reminder, nothing else new: no street address and no payment
-- data. Only sub_reminder_claim changes; the rest of the reminder system is untouched.
-- Run after 20261118000100_telecaller.sql. Safe to run again.
-- =============================================================================

create or replace function public.sub_reminder_claim(p_limit integer default 10, p_mode text default 'dry_run', p_lease_seconds integer default 300, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Asia/Kolkata')::date;
  s public.reminder_call_settings;
  r public.subscription_reminders;
  v_ids uuid[];
  v_why text;
  v_phone text;
  v_consent text;
  v_claimed uuid[] := '{}';
begin
  select * into s from public.reminder_call_settings where id;

  -- A worker that stopped in the middle of a LIVE call attempt may or may not have placed the call: never repeat it, report it.
  -- (A dry-run attempt has no effect, so it simply goes back in the queue.)
  update public.subscription_reminders
     set status = case when p_mode = 'live' then 'FAILED' else 'SCHEDULED' end,
         reason = case when p_mode = 'live' then 'The result was never recorded (the server stopped). Not retried, to avoid calling the customer twice.' else reason end,
         locked_until = null, updated_at = v_now
   where status = 'PROCESSING' and locked_until < v_now;

  -- Withdraw reminders that are no longer valid.
  update public.subscription_reminders sr
     set status = 'CANCELLED', reason = private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date), locked_until = null, updated_at = v_now
   where sr.status in ('SCHEDULED', 'RETRY', 'DRY_RUN') and private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date) is not null;

  -- A reminder whose window has closed is not sent late (and never in a burst the next day).
  update public.subscription_reminders
     set status = 'SKIPPED', reason = 'The call window for this reminder has passed.', locked_until = null, updated_at = v_now
   where status in ('SCHEDULED', 'RETRY') and send_until < v_now;

  select coalesce(array_agg(id), '{}') into v_ids from (
    select sr.id from public.subscription_reminders sr
     where sr.send_after <= v_now and sr.send_until >= v_now
       and ((sr.status in ('SCHEDULED', 'RETRY') and sr.next_attempt_at <= v_now) or (p_mode = 'live' and sr.status = 'DRY_RUN'))
     order by sr.send_after, sr.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;

  for r in select * from public.subscription_reminders where id = any (v_ids) order by send_after, created_at loop
    v_why := null;
    v_phone := private.sub_reminder_phone(r.customer_id);
    select coalesce((select k.status from public.customer_reminder_consent k where k.customer_id = r.customer_id), 'UNKNOWN') into v_consent;
    if v_consent = 'DO_NOT_CALL' then
      v_why := 'The customer asked not to be called.';
    elsif v_consent = 'UNKNOWN' and not s.allow_unknown_consent then
      v_why := 'No call consent is recorded for this customer.';
    elsif v_phone is null then
      v_why := 'The customer has no valid Indian mobile number.';
    end if;
    if v_why is not null then
      update public.subscription_reminders set status = 'SKIPPED', reason = v_why, locked_until = null, updated_at = v_now where id = r.id;
      perform private.sub_reminder_log(r.id, 'SKIPPED', r.attempts, null, v_why);
    else
      update public.subscription_reminders
         set status = 'PROCESSING', attempts = case when r.status = 'DRY_RUN' then 1 else r.attempts + 1 end,
             phone_masked = '+91XXXXXX' || right(v_phone, 4), reason = null, updated_at = v_now,
             locked_until = v_now + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 1800)))
       where id = r.id;
      perform private.sub_reminder_log(r.id, 'ATTEMPT', case when r.status = 'DRY_RUN' then 1 else r.attempts + 1 end, null, 'Claimed (' || p_mode || ')');
      v_claimed := v_claimed || r.id;
    end if;
  end loop;

  -- Only what the caller needs to place the call. The calling service (BolifyAI) takes name, phone, e-mail, service and location,
  -- so the e-mail and the city are handed over now; no street address, no payment data.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', sr.id, 'attempts', sr.attempts, 'stage', sr.stage, 'expiryDate', sr.expiry_date, 'daysLeft', sr.expiry_date - v_today,
             'phone', private.sub_reminder_phone(sr.customer_id), 'customerId', c.id,
             'firstName', split_part(btrim(c.name), ' ', 1), 'lastName', btrim(substr(btrim(c.name), length(split_part(btrim(c.name), ' ', 1)) + 1)),
             'company', c.company, 'email', nullif(btrim(c.email), ''), 'location', nullif(btrim(c.city), ''),
             'serviceCode', sr.service_code, 'serviceName', sv.name, 'planName', cs.plan_name) order by sr.send_after, sr.created_at)
      from public.subscription_reminders sr
      join public.customers c on c.id = sr.customer_id
      left join public.crm_services sv on sv.code = sr.service_code
      left join public.customer_services cs on cs.customer_id = sr.customer_id and cs.service_code = sr.service_code
     where sr.id = any (v_claimed)), '[]'::jsonb);
end $$;
revoke all on function public.sub_reminder_claim(integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_reminder_claim(integer, text, integer, timestamptz) to service_role;
