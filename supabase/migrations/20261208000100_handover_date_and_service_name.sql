-- =============================================================================
-- 1. The handover date is the moment of the handover, set by the database.
-- 2. "Crocodile" is spelled "Crocodial".
--
-- 1. What was wrong
--   The onboarding header asked Sales to pick a "Target handover" date by hand ("Set date"), although the handover itself already happens
--   on a button click. customer_onboarding.forwarded_to_support_at is that moment (now() inside forward_to_consultant, never the browser's
--   clock), but it is cleared when the verifier sends the customer back, so the first handover was not kept, and a handover left no line
--   of its own in the customer's history.
--
--   Now: first_handed_over_at is written once (never overwritten, not even by a later handover) and every handover - the first and any
--   after a return - writes its own HANDED_OVER line in the customer history with the recipient's role. Both come from one trigger on the
--   same update that sets forwarded_to_support_at, so a retried request (which the send function already refuses: "Already sent") cannot
--   make a second event. Opening or editing the record changes nothing: only the null -> value change of forwarded_to_support_at counts.
--   The manual date column (target_handover_date) stays in the table for the records that have one; the screens no longer ask for it.
--
-- 2. The service is renamed in its one catalogue row (crm_services.name); its code, id, prices, routing, document requirements and every
--   customer's purchase stay as they are, and nothing is inserted. Names typed into history (invoice lines, audit text) are not rewritten.
--
-- Safe to run again. Changes no payment, invoice or total.
-- =============================================================================

alter table public.customer_onboarding add column if not exists first_handed_over_at timestamptz;

-- what happened before this migration: the first handover is the one still recorded (never invented for a customer not handed over)
update public.customer_onboarding set first_handed_over_at = forwarded_to_support_at where first_handed_over_at is null and forwarded_to_support_at is not null;

create or replace function private.tg_onboarding_handover()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_role text;
begin
  if new.forwarded_to_support_at is null or old.forwarded_to_support_at is not null then
    return new; -- only the moment the handover happens counts
  end if;
  -- the first handover is kept for good
  if old.first_handed_over_at is null then
    new.first_handed_over_at := new.forwarded_to_support_at;
  else
    new.first_handed_over_at := old.first_handed_over_at;
  end if;
  select * into c from public.customers where id = new.customer_id;
  v_role := case when private.onboarding_route(new.customer_id) = 'META' then 'Meta Verifier' else 'Technical Consultant' end;
  perform private.log_customer_activity(new.customer_id, 'HANDED_OVER',
    format('Handed over to the %s on %s', v_role, to_char(new.forwarded_to_support_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')));
  return new;
end $$;
revoke all on function private.tg_onboarding_handover() from public, anon, authenticated;
drop trigger if exists customer_onboarding_handover on public.customer_onboarding;
create trigger customer_onboarding_handover before update of forwarded_to_support_at on public.customer_onboarding
  for each row execute function private.tg_onboarding_handover();

-- the first handover cannot be edited by anyone through the table API (the trigger writes it)
revoke update (first_handed_over_at) on public.customer_onboarding from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Crocodial
-- ---------------------------------------------------------------------------
update public.crm_services set name = 'Crocodial (Call CRM)' where code = 'CROCODILE_CHANNEL_WEBHOOK' and name <> 'Crocodial (Call CRM)';

-- the usage import finds the service by either spelling (older sheets still say Crocodile)
create or replace function private.import_service_code(p text)
returns text language sql stable security definer set search_path = '' as $$
  with k as (select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) as v)
  select coalesce(
    (select s.code from public.crm_services s, k where lower(s.code) = k.v or lower(s.name) = k.v limit 1),
    (select a.code from k, (values
        ('whatsapp api', 'WHATSAPP_API_BLUE_TICK'), ('whatsapp api + blue tick', 'WHATSAPP_API_BLUE_TICK'), ('whatsapp', 'WHATSAPP_API_BLUE_TICK'),
        ('rcs registration + platform', 'RCS_REGISTRATION'), ('rcs', 'RCS_REGISTRATION'),
        ('voice message', 'VOICE_MESSAGE_BULK'), ('voice message (bulk)', 'VOICE_MESSAGE_BULK'), ('voice', 'VOICE_MESSAGE_BULK'),
        ('crocodial (call crm)', 'CROCODILE_CHANNEL_WEBHOOK'), ('crocodial', 'CROCODILE_CHANNEL_WEBHOOK'),
        -- the old spelling still finds the service in older sheets
        ('crocodile (call crm)', 'CROCODILE_CHANNEL_WEBHOOK'), ('crocodile', 'CROCODILE_CHANNEL_WEBHOOK'),
        ('gbp setup', 'GBP_SETUP'), ('gbp management', 'GBP_MANAGEMENT'), ('gmb ranking', 'GMB_RANKING'),
        ('meta ads', 'META_ADS_MANAGEMENT'), ('social media', 'SOCIAL_MEDIA_MANAGEMENT')) a(name, code)
      where a.name = k.v and exists (select 1 from public.crm_services s where s.code = a.code)))
$$;
revoke all on function private.import_service_code(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
