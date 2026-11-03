-- Service-specific onboarding journeys, automatic client-visible status, and the standalone WhatsApp API service.
--
-- WHAT EXISTED (read before changing anything)
--   * 20261120000100 already adds the three WhatsApp services as catalogue rows: WHATSAPP_API_BLUE_TICK (unchanged), WHATSAPP_API and
--     BLUE_TICK, with the same checklist items as the combined service. If the service picker shows only the combined one, that migration
--     has not been run on that database: this file does NOT add them again (run 20261120000100 first, it is safe to run twice).
--   * The client's per-service progress (client_service_progress_one, 20261205000400) chose the track of a service from the CUSTOMER's
--     verification route, so one Meta service dragged every other service of a mixed customer onto the Meta steps. The overall journey
--     (client_journey, 20261209000100) titled its verification stage "Meta verification" for every customer, even when a Technical Consultant,
--     not Meta, does the verification.
--   * Meta status already moves by itself in three places (documents reach the verifier -> IN_PROGRESS, a document sent back ->
--     DOCUMENTS_REQUIRED, corrected -> IN_PROGRESS). Completion (the real Meta decision) is the one thing no machine signal exists for.
--
-- WHAT THIS ADDS (additive: no table dropped, no row deleted, no existing customer's progress reset)
--   1. private.service_track(code): META / TECHNICAL / DIRECT from the service's OWN catalogue flags.
--   2. service_milestones: data-driven steps per service (a service without rows keeps the three default tracks). Seeded for WHATSAPP_API
--      only, because the combined service and Blue Tick keep their existing Meta track. Each step has a rule the database evaluates from
--      stored facts (payment, documents, review, Meta approval, setup, activation): nobody types a step's status.
--   3. customer_existing_blue_tick: a customer who already holds a Blue Tick and buys only WhatsApp API. Records who said so and who
--      confirmed it; it never changes the sale, the invoice or the badge, and a checkbox alone is never "verified".
--   4. private.client_service_progress_one: per-service track + milestones + a client state per step (not started / in progress /
--      waiting for customer / under review / action required / completed) + an overall percent that counts only applicable required steps.
--   5. private.client_journey: the verification stage is titled for what it really is (Meta, or our team), every service shows its own
--      waiting reason and progress, and the overall percent comes from the services' applicable steps (never 100 before completion).
--   6. Service setup starts by itself (PENDING -> IN_PROGRESS) when payment, verification and the Relationship Manager are done.
--      "Ready" stays a person's authorised action (activation). A manual "Start" on an automatically started service is accepted.
--   7. record_meta_outcome: the authoritative Meta decision, idempotent by event key, with an evidence reference. It reuses
--      set_meta_verification (so every existing rule applies) and is the one place a signed webhook would later call.
--   8. customer_journey_status: the live status for the team (steps per service, what is outstanding, whether the last change was
--      automatic) so a verifier no longer mirrors statuses by hand.
--
-- Run after 20261222000300_recruiter_workspace.sql (and after 20261120000100 if the catalogue still has 31 services). Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. The track of a service comes from the service itself
-- ---------------------------------------------------------------------------
create or replace function private.service_track(p_service text)
returns text language sql stable security definer set search_path = '' as $$
  select case when not s.requires_technical_consultant then 'DIRECT'
              when s.requires_meta_verification then 'META'
              else 'TECHNICAL' end
    from public.crm_services s where s.code = p_service
$$;
revoke all on function private.service_track(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. An existing Blue Tick (kept apart from the sale: it never adds or removes a service)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_existing_blue_tick (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  status text not null default 'NOT_PROVIDED' check (status in ('NOT_PROVIDED', 'CUSTOMER_REPORTED', 'CONFIRMED', 'COULD_NOT_CONFIRM')),
  reference text check (length(reference) <= 300),
  note text check (length(note) <= 500),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz
);
alter table public.customer_existing_blue_tick enable row level security;
revoke all on table public.customer_existing_blue_tick from public, anon, authenticated;

create or replace function public.set_existing_blue_tick(p_customer uuid, p_status text, p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  b public.customer_existing_blue_tick;
  me uuid := private.my_id();
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_ref text := left(nullif(btrim(coalesce(p_reference, '')), ''), 300);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_review boolean;
  v_touch boolean;
begin
  if me is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  v_review := private.may_run_meta(p_customer);
  v_touch := v_review or private.can_access_customer(p_customer);
  if not v_touch then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_status not in ('NOT_PROVIDED', 'CUSTOMER_REPORTED', 'CONFIRMED', 'COULD_NOT_CONFIRM') then
    raise exception 'VALIDATION_ERROR: Choose Not provided, Customer reports existing verification, Verification confirmed or Could not be confirmed.' using errcode = 'P0001';
  end if;
  if v_status in ('CONFIRMED', 'COULD_NOT_CONFIRM') and not v_review then
    raise exception 'FORBIDDEN: Only the verifier of this customer can confirm an existing Blue Tick.' using errcode = '42501';
  end if;
  if v_status = 'CONFIRMED' and v_ref is null then
    raise exception 'VALIDATION_ERROR: Enter the reference you checked (for example the verified business name or the Meta Business ID) to confirm the Blue Tick.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  if c.id is null or not exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = 'WHATSAPP_API') then
    raise exception 'CONFLICT: This only applies to a customer who bought WhatsApp API on its own.' using errcode = 'P0001';
  end if;
  select * into b from public.customer_existing_blue_tick where customer_id = p_customer for update;
  if b.customer_id is not null and b.status in ('CONFIRMED', 'COULD_NOT_CONFIRM') and not v_review then
    raise exception 'CONFLICT: The verifier has already reviewed this. Ask the verifier to change it.' using errcode = 'P0001';
  end if;
  insert into public.customer_existing_blue_tick as t (customer_id, status, reference, note, recorded_by, recorded_at, reviewed_by, reviewed_at)
  values (p_customer, v_status, v_ref, v_note, me, now(),
          case when v_status in ('CONFIRMED', 'COULD_NOT_CONFIRM') then me end,
          case when v_status in ('CONFIRMED', 'COULD_NOT_CONFIRM') then now() end)
  on conflict (customer_id) do update
    set status = excluded.status, reference = excluded.reference, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at,
        reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
  perform private.log_customer_activity(p_customer, 'EXISTING_BLUE_TICK',
    format('Existing Blue Tick: %s', lower(replace(v_status, '_', ' ')))) ;
  perform private.write_audit('EXISTING_BLUE_TICK_RECORDED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('from', b.status, 'to', v_status, 'hasReference', v_ref is not null));
  return public.customer_existing_blue_tick(p_customer);
end $$;
revoke all on function public.set_existing_blue_tick(uuid, text, text, text) from public, anon;
grant execute on function public.set_existing_blue_tick(uuid, text, text, text) to authenticated;

create or replace function public.customer_existing_blue_tick(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.customer_existing_blue_tick;
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer) or private.may_run_meta(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into b from public.customer_existing_blue_tick where customer_id = p_customer;
  return jsonb_build_object(
    'applies', exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = 'WHATSAPP_API'),
    'status', coalesce(b.status, 'NOT_PROVIDED'), 'reference', b.reference, 'note', b.note,
    'recordedAt', b.recorded_at, 'reviewedAt', b.reviewed_at,
    'reviewer', (select p.full_name from public.profiles p where p.id = b.reviewed_by),
    'canReview', private.may_run_meta(p_customer));
end $$;
revoke all on function public.customer_existing_blue_tick(uuid) from public, anon;
grant execute on function public.customer_existing_blue_tick(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Milestones per service (data, edited by engineering / the Super Admin through SQL; a service without rows uses its track's default)
-- ---------------------------------------------------------------------------
create table if not exists public.service_milestones (
  service_code text not null references public.crm_services (code) on delete cascade,
  key text not null check (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  sort_order integer not null,
  label text not null check (length(label) between 2 and 80),
  description text check (length(description) <= 300),
  hint text check (length(hint) <= 300),
  rule text not null check (rule in ('PAID', 'DOCS_RECEIVED', 'DOCS_CHECKED', 'ITEMS_VERIFIED', 'META_APPROVED', 'BLUE_TICK_REVIEWED', 'SETUP_STARTED', 'HANDED_OVER', 'DELIVERY_SENT', 'LIVE')),
  owner text not null default 'TEAM' check (owner in ('CUSTOMER', 'TEAM', 'META')),
  applies_when text check (applies_when in ('EXISTING_BLUE_TICK')),
  is_required boolean not null default true,
  is_active boolean not null default true,
  primary key (service_code, key)
);
alter table public.service_milestones enable row level security;
revoke all on table public.service_milestones from public, anon, authenticated;

-- WhatsApp API on its own: the API steps, with no Blue Tick application. An existing Blue Tick adds one optional "checked" step; it is
-- never a reason to skip the number / WABA eligibility or the provisioning.
insert into public.service_milestones (service_code, key, sort_order, label, description, hint, rule, owner, applies_when, is_required)
select v.*
  from (values
    ('WHATSAPP_API', 'ORDER', 10, 'Order confirmed', 'Your payment is verified.', 'We confirm your order as soon as your payment is verified.', 'PAID', 'TEAM', null, true),
    ('WHATSAPP_API', 'DOCUMENTS', 20, 'Business & account details received', 'The documents and details we need for the WhatsApp Business API.', 'We are collecting your business and account details.', 'DOCS_RECEIVED', 'CUSTOMER', null, true),
    ('WHATSAPP_API', 'BLUE_TICK', 30, 'Existing Blue Tick checked', 'You told us you already have a verified Blue Tick. We check it; this does not start a new Blue Tick application.', 'Our team is checking the Blue Tick you already have.', 'BLUE_TICK_REVIEWED', 'TEAM', 'EXISTING_BLUE_TICK', false),
    ('WHATSAPP_API', 'ELIGIBILITY', 40, 'Number & account eligibility verified', 'Your WhatsApp number, Facebook Business Manager and WABA details are checked.', 'Our team is checking your number and account details.', 'DOCS_CHECKED', 'TEAM', null, true),
    ('WHATSAPP_API', 'META', 50, 'WhatsApp Business account approved by Meta', 'Meta approves your WhatsApp Business account.', 'Your WhatsApp Business account is with Meta. This usually takes about 2-3 weeks.', 'META_APPROVED', 'META', null, true),
    ('WHATSAPP_API', 'PROVISIONING', 60, 'API provisioning started', 'Our team provisions your WhatsApp API and configures the integration.', 'Our team is provisioning your WhatsApp API and configuring the integration.', 'SETUP_STARTED', 'TEAM', null, true),
    ('WHATSAPP_API', 'LIVE', 70, 'API connected, tested and live', 'The API connection and messaging are tested, and the service is live.', 'Your service goes live once everything is complete.', 'LIVE', 'TEAM', null, true)
  ) as v(service_code, key, sort_order, label, description, hint, rule, owner, applies_when, is_required)
 where exists (select 1 from public.crm_services s where s.code = v.service_code)
on conflict (service_code, key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. What one service has collected: the items that belong to it (and the shared always-required ones, collected once)
-- ---------------------------------------------------------------------------
create or replace function private.service_items_state(p_customer uuid, p_service text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'saved', count(*) filter (where e.status in ('SAVED', 'VERIFIED')),
    'verified', count(*) filter (where e.status = 'VERIFIED'),
    'rejected', count(*) filter (where e.status = 'REJECTED'))
    from private.customer_items(p_customer) i
    left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code
   where not coalesce(i.is_optional, false)
     and (i.always_required or exists (select 1 from public.onboarding_item_services m where m.item_code = i.code and m.service_code = p_service))
$$;
revoke all on function private.service_items_state(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The steps of one service (derived from stored facts only)
-- ---------------------------------------------------------------------------
create or replace function private.client_service_progress_one(
  p_customer uuid, p_service text, p_paid boolean, p_paid_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cs public.customer_services;
  sv public.crm_services;
  o public.customer_onboarding;
  bt public.customer_existing_blue_tick;
  v_track text;
  v_status text;
  v_live boolean;
  v_items jsonb;
  v_rejected integer;
  v_missing boolean;
  v_def jsonb;
  m jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_prev_done boolean := true;
  v_current text := null;
  v_done boolean;
  v_at timestamptz;
  v_state text;
  v_cstate text;
  v_hint text;
  v_required boolean;
  v_total integer := 0;
  v_ready integer := 0;
  v_action boolean := false;
  v_last timestamptz;
  v_meta text;
  v_client_status text;
begin
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  select * into sv from public.crm_services where code = p_service;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into bt from public.customer_existing_blue_tick where customer_id = p_customer;
  if cs.customer_id is null or sv.code is null then
    return null;
  end if;

  -- the same status client_services() reports
  v_status := private.client_service_state(p_customer, p_service);
  v_live := v_status = 'LIVE';
  v_track := private.service_track(p_service);
  v_items := private.service_items_state(p_customer, p_service);
  v_rejected := coalesce((v_items ->> 'rejected')::int, 0);
  v_missing := coalesce((v_items ->> 'saved')::int, 0) < coalesce((v_items ->> 'total')::int, 0);
  v_meta := coalesce(o.meta_status, 'PENDING');
  v_client_status := to_jsonb(o) ->> 'client_status';

  -- the steps: this service's own milestones, else its track's default (the same steps and words as before)
  select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'label', x.label, 'description', x.description, 'hint', x.hint, 'rule', x.rule,
                                                'owner', x.owner, 'required', x.is_required) order by x.sort_order), '[]'::jsonb)
    into v_def
    from public.service_milestones x
   where x.service_code = p_service and x.is_active
     and (x.applies_when is null or (x.applies_when = 'EXISTING_BLUE_TICK' and coalesce(bt.status, 'NOT_PROVIDED') <> 'NOT_PROVIDED'));
  if jsonb_array_length(v_def) = 0 then
    v_def := case v_track
      when 'META' then jsonb_build_array(
        jsonb_build_object('key', 'ORDER', 'label', 'Order confirmed', 'rule', 'PAID', 'owner', 'TEAM', 'required', true, 'hint', 'We confirm your order as soon as your payment is verified.'),
        jsonb_build_object('key', 'DOCUMENTS', 'label', 'Documents received', 'rule', 'DOCS_RECEIVED', 'owner', 'CUSTOMER', 'required', true, 'hint', 'We are collecting your documents.'),
        jsonb_build_object('key', 'VERIFICATION', 'label', 'Verification by our team', 'rule', 'DOCS_CHECKED', 'owner', 'TEAM', 'required', true, 'hint', 'Our team is checking your documents.'),
        jsonb_build_object('key', 'META', 'label', 'Meta verification', 'rule', 'META_APPROVED', 'owner', 'META', 'required', true, 'hint', 'Your application is with Meta. This usually takes about 2-3 weeks.'),
        jsonb_build_object('key', 'LIVE', 'label', 'Service live', 'rule', 'LIVE', 'owner', 'TEAM', 'required', true, 'hint', 'Your service goes live once everything is complete.'))
      when 'TECHNICAL' then jsonb_build_array(
        jsonb_build_object('key', 'ORDER', 'label', 'Order confirmed', 'rule', 'PAID', 'owner', 'TEAM', 'required', true, 'hint', 'We confirm your order as soon as your payment is verified.'),
        jsonb_build_object('key', 'DOCUMENTS', 'label', 'Documents received', 'rule', 'DOCS_RECEIVED', 'owner', 'CUSTOMER', 'required', true, 'hint', 'We are collecting your documents.'),
        jsonb_build_object('key', 'VERIFICATION', 'label', 'Verified by our team', 'rule', 'DOCS_CHECKED', 'owner', 'TEAM', 'required', true, 'hint', 'Our team is checking your documents.'),
        jsonb_build_object('key', 'SETUP', 'label', 'Set-up with our team', 'rule', 'HANDED_OVER', 'owner', 'TEAM', 'required', true, 'hint', 'A member of our team is setting up your service.'),
        jsonb_build_object('key', 'LIVE', 'label', 'Service live', 'rule', 'LIVE', 'owner', 'TEAM', 'required', true, 'hint', 'Your service goes live once everything is complete.'))
      else jsonb_build_array(
        jsonb_build_object('key', 'ORDER', 'label', 'Order confirmed', 'rule', 'PAID', 'owner', 'TEAM', 'required', true, 'hint', 'We confirm your order as soon as your payment is verified.'),
        jsonb_build_object('key', 'DOCUMENTS', 'label', 'Documents verified', 'rule', 'ITEMS_VERIFIED', 'owner', 'CUSTOMER', 'required', true, 'hint', 'We are collecting and checking your documents.'),
        jsonb_build_object('key', 'DELIVERY', 'label', 'With our delivery team', 'rule', 'DELIVERY_SENT', 'owner', 'TEAM', 'required', true, 'hint', 'Our delivery team will take your order forward.'),
        jsonb_build_object('key', 'LIVE', 'label', 'Service live', 'rule', 'LIVE', 'owner', 'TEAM', 'required', true, 'hint', 'Your service goes live once everything is complete.'))
      end;
  end if;

  for m in select * from jsonb_array_elements(v_def) loop
    v_required := coalesce((m ->> 'required')::boolean, true);
    v_at := null;
    case m ->> 'rule'
      when 'PAID' then v_done := coalesce(p_paid, false); v_at := p_paid_at;
      when 'DOCS_RECEIVED' then
        v_done := coalesce(o.forwarded_to_support_at is not null or o.handover_stage <> 'CONSULTANT', false); v_at := o.forwarded_to_support_at;
      when 'DOCS_CHECKED' then
        v_done := coalesce(o.handover_stage <> 'CONSULTANT' or (o.review_state = 'VERIFIED' and o.returned_at is null), false); v_at := o.to_department_head_at;
      when 'ITEMS_VERIFIED' then
        -- this service's own items are all authorized (so another service's missing documents do not hold it back), or - as before - the
        -- whole checklist of the customer is
        v_done := o.customer_id is null or coalesce((v_items ->> 'total')::int, 0) = 0
                  or (coalesce((v_items ->> 'verified')::int, 0) >= coalesce((v_items ->> 'total')::int, 0) and v_rejected = 0)
                  or (o.items_total = 0 or (o.items_verified >= o.items_total and o.items_rejected = 0));
      when 'META_APPROVED' then
        v_done := coalesce(o.meta_completed_at is not null or v_client_status = 'COMPLETED', false); v_at := o.meta_completed_at;
      when 'BLUE_TICK_REVIEWED' then
        v_done := coalesce(bt.status, 'NOT_PROVIDED') in ('CONFIRMED', 'COULD_NOT_CONFIRM'); v_at := bt.reviewed_at;
      when 'SETUP_STARTED' then v_done := cs.setup_status in ('IN_PROGRESS', 'READY'); v_at := cs.setup_updated_at;
      when 'HANDED_OVER' then v_done := coalesce(o.handover_stage = 'TEAM_MEMBER', false); v_at := o.assigned_to_member_at;
      when 'DELIVERY_SENT' then v_done := cs.sent_to_delivery_at is not null; v_at := cs.sent_to_delivery_at;
      else v_done := v_live; v_at := cs.activated_at;
    end case;

    v_hint := m ->> 'hint';
    if v_live or (v_done and (v_prev_done or not v_required)) then
      v_state := 'DONE';
      v_cstate := 'COMPLETED';
    elsif not v_required then
      -- an optional step never holds the others back
      v_state := 'UPCOMING';
      v_cstate := case when (m ->> 'rule') = 'BLUE_TICK_REVIEWED' and bt.status = 'CUSTOMER_REPORTED' then 'UNDER_REVIEW' else 'NOT_STARTED' end;
    elsif v_prev_done and v_done then
      v_state := 'DONE';
      v_cstate := 'COMPLETED';
    elsif v_prev_done then
      v_state := 'CURRENT';
      v_current := m ->> 'key';
      v_prev_done := false;
      v_cstate := case m ->> 'rule'
        when 'DOCS_RECEIVED' then case when v_rejected > 0 or o.returned_at is not null then 'ACTION_REQUIRED' when v_missing then 'WAITING_FOR_CUSTOMER' else 'IN_PROGRESS' end
        when 'ITEMS_VERIFIED' then case when v_rejected > 0 then 'ACTION_REQUIRED' when v_missing then 'WAITING_FOR_CUSTOMER' else 'UNDER_REVIEW' end
        when 'DOCS_CHECKED' then case when v_rejected > 0 then 'ACTION_REQUIRED' else 'UNDER_REVIEW' end
        when 'META_APPROVED' then case when v_meta in ('DOCUMENTS_REQUIRED', 'REJECTED') then 'ACTION_REQUIRED' when v_meta = 'IN_PROGRESS' then 'UNDER_REVIEW' else 'IN_PROGRESS' end
        else 'IN_PROGRESS' end;
      if (m ->> 'rule') in ('DOCS_RECEIVED', 'ITEMS_VERIFIED', 'DOCS_CHECKED') and v_rejected > 0 then
        v_hint := 'A document needs to be corrected. Please check your Documents.';
      elsif (m ->> 'rule') = 'DOCS_RECEIVED' and o.returned_at is not null then
        v_hint := 'Some documents need to be corrected. Our team will contact you.';
      elsif (m ->> 'rule') = 'META_APPROVED' and v_meta in ('DOCUMENTS_REQUIRED', 'REJECTED') then
        v_hint := coalesce(left(o.meta_feedback, 300), 'Meta needs something from you. Please check your Onboarding Journey.');
      end if;
    else
      v_state := 'UPCOMING';
      v_prev_done := false;
      v_cstate := 'NOT_STARTED';
    end if;

    if v_required then
      v_total := v_total + 1;
      if v_state = 'DONE' then
        v_ready := v_ready + 1;
      end if;
    end if;
    if v_cstate in ('ACTION_REQUIRED', 'WAITING_FOR_CUSTOMER') then
      v_action := true;
    end if;
    if v_state = 'DONE' and v_at is not null and (v_last is null or v_at > v_last) then
      v_last := v_at;
    end if;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'key', m ->> 'key', 'label', m ->> 'label', 'description', m ->> 'description', 'state', v_state, 'clientState', v_cstate,
      'owner', m ->> 'owner', 'required', v_required,
      'at', case when v_state = 'DONE' then v_at end,
      'hint', case when v_state = 'CURRENT' then v_hint end));
  end loop;

  return jsonb_build_object(
    'code', sv.code, 'name', sv.name, 'status', v_status, 'steps', v_steps, 'track', v_track,
    'current', case when v_live then null else v_current end,
    'headline', case when v_live then 'Live'
                     else (select s ->> 'label' from jsonb_array_elements(v_steps) s where s ->> 'state' = 'CURRENT' limit 1) end,
    'stepsTotal', v_total, 'stepsDone', v_ready,
    'percent', case when v_live then 100 when v_total = 0 then 0 else least(99, floor(100.0 * v_ready / v_total)::int) end,
    'actionRequired', v_action and not v_live, 'updatedAt', v_last);
end $$;
revoke all on function private.client_service_progress_one(uuid, text, boolean, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The overall journey (the same function as 20261209000100 plus: the verification stage is titled for what it is, every service
--    carries its own waiting reason and progress, and the overall percent comes from the services' applicable steps)
-- ---------------------------------------------------------------------------
create or replace function private.client_journey(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  o public.customer_onboarding;
  a public.customer_client_accounts;
  f jsonb := private.client_facts(p_customer);
  v_complete boolean;
  v_pay boolean := coalesce((f ->> 'payment')::boolean, false);
  v_required boolean := coalesce((f ->> 'metaRequired')::boolean, false);
  v_meta text;
  v_meta_done boolean := coalesce((f ->> 'metaDone')::boolean, false);
  v_rm_done boolean := coalesce((f ->> 'rmDone')::boolean, false);
  v_rm_needed boolean := coalesce((f ->> 'rmNeeded')::boolean, false);
  v_svc_done boolean := coalesce((f ->> 'servicesDone')::boolean, false);
  v_verifier public.profiles;
  v_rmp public.profiles;
  v_lead public.profiles;
  v_s_pay text; v_s_meta text; v_s_rm text; v_s_svc text; v_s_done text;
  v_current text;
  v_services jsonb;
  v_outstanding jsonb;
  v_chat text;
  v_meta_hist boolean;
  v_paid_amt boolean;
  v_paid_at timestamptz;
  v_external boolean;
  v_steps_done integer;
  v_steps_total integer;
  v_pct integer;
begin
  select * into c from public.customers where id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  v_complete := not coalesce((f ->> 'applies')::boolean, false);
  v_meta := coalesce(o.meta_status, 'PENDING');
  select * into v_verifier from public.profiles where id = private.meta_verifier_of(p_customer);
  select * into v_rmp from public.profiles where id = private.rm_of(p_customer);
  select * into v_lead from public.profiles where id = private.rm_lead_of(p_customer);
  select (cc.amount_verified > 0) into v_paid_amt from public.customers cc where cc.id = p_customer;
  select min(p.verified_at) into v_paid_at from public.customer_payments p where p.customer_id = p_customer and p.status = 'VERIFIED';
  -- is the verification really Meta's (a service the catalogue marks as verified by Meta), or our own team's?
  v_external := exists (select 1 from public.customer_services cs2 join public.crm_services s2 on s2.code = cs2.service_code
                         where cs2.customer_id = p_customer and s2.requires_meta_verification);

  -- stage states -------------------------------------------------------------
  v_s_pay := case when v_complete or v_pay then 'COMPLETED' else 'IN_PROGRESS' end;
  v_s_meta := case
    when v_complete or v_meta_done then 'COMPLETED'
    when not v_pay then 'PENDING'
    when v_meta = 'DOCUMENTS_REQUIRED' then 'ACTION_REQUIRED'
    when v_meta = 'REJECTED' then 'REJECTED'
    when v_meta = 'IN_PROGRESS' then 'IN_PROGRESS'
    else 'PENDING' end;
  v_s_rm := case
    when v_complete or (v_meta_done and v_rm_done) then 'COMPLETED'
    when v_meta_done then 'IN_PROGRESS'
    else 'PENDING' end;
  v_s_svc := case
    when v_complete or v_svc_done then 'COMPLETED'
    when v_meta_done and v_rm_done then 'IN_PROGRESS'
    else 'PENDING' end;
  v_s_done := case when v_complete then 'COMPLETED' else 'PENDING' end;
  v_current := case
    when v_s_pay <> 'COMPLETED' then 'PAYMENT'
    when v_s_meta <> 'COMPLETED' then 'META_VERIFICATION'
    when v_s_rm <> 'COMPLETED' then 'RELATIONSHIP_MANAGER'
    when v_s_svc <> 'COMPLETED' then 'SERVICE_SETUP'
    else 'COMPLETED' end;

  -- the Meta items still needed from the client (required items that are missing or were sent back)
  select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label,
           'status', case when e.item_code is null then 'MISSING' else e.status end,
           'note', case when e.status = 'REJECTED' then e.review_note end) order by i.sort_order), '[]'::jsonb)
    into v_outstanding
    from private.client_items(p_customer) i
    left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code
   where not coalesce(i.is_optional, false) and coalesce(e.status, 'MISSING') in ('MISSING', 'REJECTED');

  -- each purchased service on its own: its own track, waiting reason and progress
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', s.code, 'name', s.name, 'category', s.category,
           'status', case when cs.setup_status = 'READY' then 'READY'
                          when not (v_meta_done and v_rm_done) and not v_complete then 'PENDING'
                          else cs.setup_status end,
           'waitingFor', case when cs.setup_status = 'READY' or v_complete then null
                              when not v_meta_done then case when private.service_track(s.code) = 'META' then 'Meta verification' else 'Verification by our team' end
                              when not v_rm_done then 'Relationship Manager assignment' end,
           'readyAt', cs.setup_completed_at, 'note', cs.setup_note,
           'track', private.service_track(s.code), 'headline', pr.p ->> 'headline', 'percent', (pr.p ->> 'percent')::int,
           'actionRequired', coalesce((pr.p ->> 'actionRequired')::boolean, false),
           'stepsDone', (pr.p ->> 'stepsDone')::int, 'stepsTotal', (pr.p ->> 'stepsTotal')::int)
         order by cs.created_at, s.name), '[]'::jsonb)
    into v_services
    from public.customer_services cs join public.crm_services s on s.code = cs.service_code
   cross join lateral (select private.client_service_progress_one(p_customer, cs.service_code, coalesce(v_paid_amt, false), v_paid_at) as p) pr
   where cs.customer_id = p_customer;

  -- overall progress: only the applicable required steps of the purchased services count, and 100 is reached only when onboarding is complete
  select coalesce(sum((x ->> 'stepsDone')::int), 0), coalesce(sum((x ->> 'stepsTotal')::int), 0) into v_steps_done, v_steps_total from jsonb_array_elements(v_services) x;
  v_pct := case when v_complete then 100
                when v_steps_total > 0 then least(99, floor(100.0 * v_steps_done / v_steps_total)::int)
                else floor(100.0 * ((v_s_pay = 'COMPLETED')::int + (v_s_meta = 'COMPLETED')::int + (v_s_rm = 'COMPLETED')::int + (v_s_svc = 'COMPLETED')::int) / 5)::int end;

  -- the chat the client is routed to now; the Meta conversation stays listed (read only) once it has messages
  v_chat := case when v_meta_done then 'RM' else 'META' end;
  v_meta_hist := exists (select 1 from public.chat_conversations x where x.kind = 'CLIENT' and x.customer_id = p_customer and x.channel = 'META' and x.last_seq > 0);

  return jsonb_build_object(
    'stage', v_current,
    'completed', v_complete,
    'completedAt', o.onboarding_completed_at,
    'progress', jsonb_build_object('done', v_steps_done, 'total', v_steps_total, 'percent', v_pct),
    'stages', jsonb_build_array(
      jsonb_build_object('key', 'PAYMENT', 'status', v_s_pay, 'current', v_current = 'PAYMENT',
        'completedAt', case when v_s_pay = 'COMPLETED' then o.accounts_confirmed_at end,
        'accountCreatedAt', a.created_at, 'accountEmail', a.email),
      jsonb_build_object('key', 'META_VERIFICATION', 'status', v_s_meta, 'current', v_current = 'META_VERIFICATION',
        'required', v_required, 'external', v_external, 'title', case when v_external then 'Meta verification' else 'Verification by our team' end,
        'metaStatus', case when v_required then v_meta else 'NOT_REQUIRED' end,
        'startedAt', o.meta_started_at, 'completedAt', case when v_s_meta = 'COMPLETED' then o.meta_completed_at end,
        'feedback', case when v_meta in ('DOCUMENTS_REQUIRED', 'REJECTED') then o.meta_feedback end,
        'updatedAt', o.meta_status_changed_at,
        'outstanding', case when v_required and v_s_meta <> 'COMPLETED' then v_outstanding else '[]'::jsonb end,
        'verifier', case when v_verifier.id is null then null else jsonb_build_object('name', v_verifier.full_name, 'position', v_verifier.position) end),
      jsonb_build_object('key', 'RELATIONSHIP_MANAGER', 'status', v_s_rm, 'current', v_current = 'RELATIONSHIP_MANAGER',
        'required', v_rm_needed,
        'completedAt', case when v_s_rm = 'COMPLETED' then o.assigned_to_member_at end,
        'manager', case when v_s_rm = 'PENDING' or v_rmp.id is null then null
                        else jsonb_build_object('name', v_rmp.full_name, 'position', v_rmp.position) end,
        'teamLead', case when v_s_rm = 'PENDING' or v_lead.id is null then null
                         else jsonb_build_object('name', v_lead.full_name, 'position', v_lead.position) end),
      jsonb_build_object('key', 'SERVICE_SETUP', 'status', v_s_svc, 'current', v_current = 'SERVICE_SETUP',
        'completedAt', case when v_s_svc = 'COMPLETED' then (select max(cs.setup_completed_at) from public.customer_services cs where cs.customer_id = p_customer) end,
        'services', v_services),
      jsonb_build_object('key', 'COMPLETED', 'status', v_s_done, 'current', v_current = 'COMPLETED', 'completedAt', o.onboarding_completed_at)),
    'chat', jsonb_build_object('active', v_chat, 'channels', jsonb_build_array(
      jsonb_build_object('channel', 'META', 'label', 'Meta verification', 'open', v_required and not v_meta_done, 'visible', v_required or v_meta_hist,
        'with', case when v_verifier.id is null then null else jsonb_build_object('name', v_verifier.full_name, 'position', v_verifier.position) end),
      jsonb_build_object('channel', 'RM', 'label', 'Relationship Manager', 'open', v_meta_done and (v_rmp.id is not null or v_lead.id is not null), 'visible', v_meta_done,
        'with', case when v_rmp.id is null then null else jsonb_build_object('name', v_rmp.full_name, 'position', v_rmp.position) end))),
    'access', private.client_access(p_customer) -> 'sections');
end $$;
revoke all on function private.client_journey(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Service setup starts by itself; "ready" stays an authorised person's action
-- ---------------------------------------------------------------------------
alter table public.customer_services add column if not exists setup_auto boolean not null default false;

create or replace function private.auto_start_service_setup(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := private.client_facts(p_customer);
  c public.customers;
  r record;
  v_names text[] := '{}';
  v_codes text[] := '{}';
begin
  if not coalesce((f ->> 'applies')::boolean, false) or not coalesce((f ->> 'payment')::boolean, false)
     or not coalesce((f ->> 'metaDone')::boolean, false) or not coalesce((f ->> 'rmDone')::boolean, false) then
    return;
  end if;
  select * into c from public.customers where id = p_customer;
  for r in select cs.service_code, s.name from public.customer_services cs join public.crm_services s on s.code = cs.service_code
            where cs.customer_id = p_customer and cs.setup_status = 'PENDING' for update of cs loop
    update public.customer_services
       set setup_status = 'IN_PROGRESS', setup_auto = true, setup_updated_at = now(), setup_updated_by = null,
           service_status = coalesce(service_status, 'SETTING_UP')
     where customer_id = p_customer and service_code = r.service_code;
    perform private.log_customer_activity(p_customer, 'SERVICE_SETUP', format('%s setup started automatically (payment, verification and the Relationship Manager are done)', r.name));
    perform private.write_audit('SERVICE_SETUP_AUTO_STARTED', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('service', r.service_code));
    v_names := v_names || r.name;
    v_codes := v_codes || r.service_code;
  end loop;
  -- one notification for the services started together (the key names them, so the same start is announced once)
  if cardinality(v_codes) > 0 then
    perform private.client_notify(p_customer, 'SERVICE_SETUP',
      case when cardinality(v_names) = 1 then format('%s setup has started', v_names[1]) else 'Setup of your services has started' end,
      case when cardinality(v_names) = 1 then 'Our team is setting it up.' else left('Our team is setting up: ' || array_to_string(v_names, ', ') || '.', 1000) end,
      'service', null, format('SETUPAUTO|%s|%s', p_customer, array_to_string(v_codes, ',')));
  end if;
end $$;
revoke all on function private.auto_start_service_setup(uuid) from public, anon, authenticated;

create or replace function private.tg_onboarding_auto_setup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.auto_start_service_setup(new.customer_id);
  return null;
end $$;
revoke all on function private.tg_onboarding_auto_setup() from public, anon, authenticated;
drop trigger if exists customer_onboarding_auto_setup on public.customer_onboarding;
create trigger customer_onboarding_auto_setup after update of meta_status, meta_completed_at, team_member_id, handover_stage, accounts_confirmed_at on public.customer_onboarding
  for each row execute function private.tg_onboarding_auto_setup();

-- A person may still take over an automatically started setup (note, then ready); everything else is as in 20261210000200.
create or replace function public.set_service_setup(p_customer uuid, p_service text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  sv public.crm_services;
  f jsonb;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_problem text;
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  select * into sv from public.crm_services where code = p_service;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  if v_status not in ('IN_PROGRESS', 'READY') then
    raise exception 'VALIDATION_ERROR: Choose In progress or Ready.' using errcode = 'P0001';
  end if;
  -- a person may take over a setup the database started by itself (to add a note); a repeat by a person is still a conflict
  if cs.setup_status = v_status and not (v_status = 'IN_PROGRESS' and cs.setup_auto) then
    raise exception 'CONFLICT: This service is already %.', lower(replace(v_status, '_', ' ')) using errcode = 'P0001';
  end if;
  if cs.setup_status = 'READY' then
    if not private.is_super_admin() then
      raise exception 'CONFLICT: This service is already ready. Only the Super Admin can reopen it.' using errcode = 'P0001';
    end if;
  end if;
  f := private.client_facts(p_customer);
  if coalesce((f ->> 'applies')::boolean, false) then
    if not coalesce((f ->> 'payment')::boolean, false) then
      raise exception 'VALIDATION_ERROR: The payment is not confirmed yet.' using errcode = 'P0001';
    end if;
    if not coalesce((f ->> 'metaDone')::boolean, false) then
      raise exception 'VALIDATION_ERROR: Meta verification is not completed yet.' using errcode = 'P0001';
    end if;
    if not coalesce((f ->> 'rmDone')::boolean, false) then
      raise exception 'VALIDATION_ERROR: The Relationship Manager is not assigned yet.' using errcode = 'P0001';
    end if;
  end if;
  if v_status = 'READY' then
    if cs.duration_code is not null and cs.started_on is null then
      raise exception 'CONFLICT: This service has a subscription. Confirm the panel activation with its dates instead: the subscription starts on the confirmed activation date.' using errcode = 'P0001';
    end if;
    v_problem := private.service_ready_problem(p_customer, p_service);
    if v_problem is not null then
      raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
    end if;
  end if;

  update public.customer_services
     set setup_status = v_status, setup_auto = false, setup_updated_at = now(), setup_updated_by = (select private.my_id()), setup_note = v_note,
         setup_completed_at = case when v_status = 'READY' then now() else null end,
         service_status = case when v_status = 'READY' then 'LIVE' else coalesce(service_status, 'SETTING_UP') end,
         activated_at = case when v_status = 'READY' then coalesce(activated_at, now()) else activated_at end
   where customer_id = p_customer and service_code = p_service;
  perform private.log_customer_activity(p_customer, 'SERVICE_SETUP', format('%s setup: %s', sv.name, lower(replace(v_status, '_', ' '))) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('SERVICE_SETUP_CHANGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'from', cs.setup_status, 'to', v_status, 'note', v_note));
  perform private.client_notify(p_customer, 'SERVICE_SETUP', case when v_status = 'READY' then format('%s is ready', sv.name) else format('%s setup has started', sv.name) end,
    case when v_status = 'READY' then 'The setup is complete. You can find it under My Services.' else coalesce(v_note, 'Our team is setting it up.') end,
    'service', null, format('SETUP|%s|%s|%s|%s', p_customer, p_service, v_status, extract(epoch from now())::bigint));
  return jsonb_build_object('service', p_service, 'status', v_status, 'note', v_note);
end $$;
revoke all on function public.set_service_setup(uuid, text, text, text) from public, anon;
grant execute on function public.set_service_setup(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The Meta decision: one event, idempotent, with its evidence
-- ---------------------------------------------------------------------------
create table if not exists public.meta_verification_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  event_key text not null check (length(event_key) between 8 and 100),
  outcome text not null check (outcome in ('APPROVED', 'REJECTED', 'NEEDS_INFO')),
  source text not null default 'MANUAL' check (source in ('MANUAL', 'WEBHOOK')),
  reference text check (length(reference) <= 300),
  note text check (length(note) <= 1000),
  result text not null default 'APPLIED' check (result in ('APPLIED', 'ALREADY_COMPLETED')),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (customer_id, event_key)
);
alter table public.meta_verification_events enable row level security;
revoke all on table public.meta_verification_events from public, anon, authenticated;

-- Approved needs the evidence reference (the Meta case / WABA reference), a rejection or a request needs the words the client will see.
-- A repeat of the same event key changes nothing. A decision never moves a completed verification backwards.
create or replace function public.record_meta_outcome(p_customer uuid, p_outcome text, p_event_key text, p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  e public.meta_verification_events;
  v_outcome text := upper(btrim(coalesce(p_outcome, '')));
  v_key text := btrim(coalesce(p_event_key, ''));
  v_ref text := left(nullif(btrim(coalesce(p_reference, '')), ''), 300);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  c public.customers;
begin
  if not private.may_run_meta(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_outcome not in ('APPROVED', 'REJECTED', 'NEEDS_INFO') then
    raise exception 'VALIDATION_ERROR: Choose Approved, Rejected or Needs information.' using errcode = 'P0001';
  end if;
  if length(v_key) < 8 or length(v_key) > 100 then
    raise exception 'VALIDATION_ERROR: The event key must be 8 to 100 characters.' using errcode = 'P0001';
  end if;
  if v_outcome = 'APPROVED' and v_ref is null then
    raise exception 'VALIDATION_ERROR: Enter the Meta reference (case or business account ID) that shows the approval.' using errcode = 'P0001';
  end if;
  if v_outcome <> 'APPROVED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Tell the client what is needed or why it was rejected.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or not private.meta_required(p_customer) then
    raise exception 'CONFLICT: This customer does not go through Meta verification.' using errcode = 'P0001';
  end if;
  select * into e from public.meta_verification_events where customer_id = p_customer and event_key = v_key;
  if e.id is not null then
    return jsonb_build_object('status', o.meta_status, 'duplicate', true, 'outcome', e.outcome, 'result', e.result);
  end if;
  if o.meta_status = 'COMPLETED' then
    if v_outcome <> 'APPROVED' then
      raise exception 'CONFLICT: Meta verification is already completed. A later rejection must be raised with the Super Admin, who reopens it.' using errcode = 'P0001';
    end if;
    insert into public.meta_verification_events (customer_id, event_key, outcome, source, reference, note, result, recorded_by)
    values (p_customer, v_key, v_outcome, 'MANUAL', v_ref, v_note, 'ALREADY_COMPLETED', (select private.my_id()));
    return jsonb_build_object('status', 'COMPLETED', 'duplicate', false, 'outcome', v_outcome, 'result', 'ALREADY_COMPLETED');
  end if;
  if v_outcome = 'APPROVED' then
    if o.meta_status = 'PENDING' then
      perform public.set_meta_verification(p_customer, 'IN_PROGRESS', null);
    end if;
    if o.meta_status in ('DOCUMENTS_REQUIRED', 'REJECTED') then
      perform public.set_meta_verification(p_customer, 'IN_PROGRESS', null);
    end if;
    perform public.set_meta_verification(p_customer, 'COMPLETED', null);
  elsif v_outcome = 'REJECTED' then
    if o.meta_status = 'PENDING' then
      perform public.set_meta_verification(p_customer, 'IN_PROGRESS', null);
    end if;
    if o.meta_status <> 'REJECTED' then
      perform public.set_meta_verification(p_customer, 'REJECTED', v_note);
    end if;
  else
    if o.meta_status in ('PENDING', 'REJECTED') then
      perform public.set_meta_verification(p_customer, 'IN_PROGRESS', null);
    end if;
    if o.meta_status <> 'DOCUMENTS_REQUIRED' then
      perform public.set_meta_verification(p_customer, 'DOCUMENTS_REQUIRED', v_note);
    end if;
  end if;
  insert into public.meta_verification_events (customer_id, event_key, outcome, source, reference, note, recorded_by)
  values (p_customer, v_key, v_outcome, 'MANUAL', v_ref, v_note, (select private.my_id()));
  perform private.write_audit('META_OUTCOME_RECORDED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('outcome', v_outcome, 'eventKey', v_key, 'hasReference', v_ref is not null));
  select * into o from public.customer_onboarding where customer_id = p_customer;
  return jsonb_build_object('status', o.meta_status, 'duplicate', false, 'outcome', v_outcome, 'result', 'APPLIED');
end $$;
revoke all on function public.record_meta_outcome(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_meta_outcome(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. What the team sees (live, calculated): the same function as 20261209000100 plus the steps of each service, what is still outstanding,
--    whether the last change was automatic, and the existing Blue Tick
-- ---------------------------------------------------------------------------
create or replace function public.customer_journey_status(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  c public.customers;
  f jsonb;
  v_can_meta boolean;
  v_paid_at timestamptz;
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer) or private.may_set_service_setup(p_customer, '')) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into c from public.customers where id = p_customer;
  select min(p.verified_at) into v_paid_at from public.customer_payments p where p.customer_id = p_customer and p.status = 'VERIFIED';
  f := private.client_facts(p_customer);
  v_can_meta := private.may_run_meta(p_customer);
  return jsonb_build_object(
    'applies', coalesce((f ->> 'applies')::boolean, false),
    'metaRequired', coalesce((f ->> 'metaRequired')::boolean, false),
    'metaExternal', exists (select 1 from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                             where cs.customer_id = p_customer and s.requires_meta_verification),
    'meta', jsonb_build_object('status', coalesce(o.meta_status, 'PENDING'), 'feedback', o.meta_feedback, 'changedAt', o.meta_status_changed_at,
        'startedAt', o.meta_started_at, 'completedAt', o.meta_completed_at, 'auto', coalesce(o.meta_status_auto, false),
        'verifier', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = o.meta_verifier_id),
        'canChange', v_can_meta and coalesce(o.meta_status, 'PENDING') <> 'COMPLETED',
        'canAssign', private.is_super_admin() or (private.my_role() = 'DEPARTMENT_HEAD' and exists (select 1 from public.customers x where x.id = p_customer and x.department_id = private.my_department_id()))
                     or private.is_verifier_for(private.my_id(), p_customer),
        'readyToComplete', o.customer_id is not null and o.returned_at is null and o.review_state = 'VERIFIED' and o.accounts_confirmed_at is not null
                           and coalesce((f ->> 'login')::boolean, false),
        'outstanding', coalesce((
          select jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label, 'status', coalesce(e.status, 'MISSING')) order by i.sort_order)
            from private.customer_items(p_customer) i
            left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code
           where not coalesce(i.is_optional, false) and coalesce(e.status, 'MISSING') <> 'VERIFIED'), '[]'::jsonb)),
    'relationshipManager', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = private.rm_of(p_customer)),
    'completedAt', o.onboarding_completed_at,
    'existingBlueTick', case when exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = 'WHATSAPP_API')
                             then public.customer_existing_blue_tick(p_customer) end,
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'status', cs.setup_status, 'note', cs.setup_note,
                  'updatedAt', cs.setup_updated_at, 'readyAt', cs.setup_completed_at, 'auto', cs.setup_auto,
                  'track', private.service_track(s.code),
                  'progress', private.client_service_progress_one(p_customer, cs.service_code, coalesce(c.amount_verified, 0) > 0, v_paid_at),
                  'canChange', private.may_set_service_setup(p_customer, s.code)) order by cs.created_at, s.name)
                from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = p_customer), '[]'::jsonb));
end $$;
revoke all on function public.customer_journey_status(uuid) from public, anon;
grant execute on function public.customer_journey_status(uuid) to authenticated;

notify pgrst, 'reload schema';
