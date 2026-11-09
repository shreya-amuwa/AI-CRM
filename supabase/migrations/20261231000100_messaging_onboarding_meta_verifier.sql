-- =============================================================================
-- Messaging services: the Meta Verifier owns the INITIAL onboarding; the Technical Consultant keeps consultation and add-ons.
-- The flow is unchanged: Sales -> Accounts -> Sales (documents) -> Meta Verifier + Technical Consultant, one customer record.
--
-- ROOT CAUSE (why a WhatsApp API customer could land with the Technical Consultant, as in "This customer is not on the Meta Verifier
-- route: the Technical Consultant verifies its documents"):
--   * The route of a customer is pinned when Sales first sends it (customer_onboarding.verification_route = private.computed_route), and
--     computed_route reads ONLY crm_services.requires_meta_verification.
--   * That flag was seeded inside "add the column if it is missing" (20261205000200): on a database where the column already existed, or
--     where the Super Admin later switched it, WHATSAPP_API / WHATSAPP_API_BLUE_TICK / BLUE_TICK can be false, so the customer is pinned to
--     TECHNICAL and the Technical Consultant gets every verification right (can_review_onboarding = the route owner).
--   * RCS Registration had no way to reach the Meta Verifier at all (setting requires_meta_verification would ALSO add Meta approval steps
--     to its client journey, which would be false).
--   * Separately, mark_meta_verification_completed accepted any Technical Consultant of the department (can_consult_customer), so a TC could
--     record "Meta verification completed" for a Meta-route customer.
--
-- WHAT THIS DOES (additive; no customer, document, entry, payment, invoice or history is deleted or reset):
--   1. crm_services.meta_verifier_onboarding: "the Meta Verifier does the initial onboarding" (who), kept apart from
--      requires_meta_verification ("Meta approves it": which client milestones apply). Set for WHATSAPP_API_BLUE_TICK, WHATSAPP_API,
--      BLUE_TICK and RCS_REGISTRATION. The three WhatsApp services also get requires_meta_verification (their Meta milestones);
--      RCS does NOT, so its client journey keeps "Verification by our team" and its RCS setup steps.
--   2. computed_route: META when any service needs Meta approval OR is Meta-Verifier onboarded. Every check that already follows the route
--      (can_review_onboarding, verify all, return to Sales, panel details, the hand-over to the Department Head, the queues) follows it.
--   3. Customers already with the Technical Consultant for a Messaging service, still in verification (not handed to the Department Head),
--      in a department that HAS an active Meta Verifier, move to the META route. Their documents keep their review state; each move is in
--      the customer's activity and the audit log (previous route kept). A department without a Meta Verifier is left as it was and is listed
--      by verification_route_review() for the Department Head / Super Admin.
--   4. mark_meta_verification_completed: a Technical Consultant may no longer record it for a Messaging customer.
--   5. Technical Consultant status: on the META route the TC track no longer reads "Verification pending / in progress" (the verification is
--      the Meta Verifier's); a person cannot set those statuses for such a customer.
--   6. Mixed customers (a Messaging service + a separately bought service on the TECHNICAL track): the Technical Consultant still authorizes
--      or rejects the items that belong ONLY to those other services (field_visit-style per-item rule, review_onboarding_entry). Verify All,
--      returning to Sales, completing and the hand-over stay with the Meta Verifier.
--   7. panel_details_list includes RCS (its panel platform / account ID).
-- Department Head and Super Admin oversight are unchanged. Accounts keeps the Client Dashboard login. Safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who does the initial onboarding (catalogue data)
-- ---------------------------------------------------------------------------
alter table public.crm_services add column if not exists meta_verifier_onboarding boolean not null default false;

do $$
declare
  r record;
begin
  for r in select code, requires_meta_verification, meta_verifier_onboarding from public.crm_services
            where code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK', 'RCS_REGISTRATION') loop
    if not r.meta_verifier_onboarding then
      update public.crm_services set meta_verifier_onboarding = true where code = r.code;
      perform private.write_audit('SERVICE_META_VERIFIER_ONBOARDING_SET', 'crm_service', null, null, null,
        jsonb_build_object('code', r.code, 'value', true, 'source', 'migration 20261231000100'));
    end if;
    if r.code <> 'RCS_REGISTRATION' and not r.requires_meta_verification then
      update public.crm_services set requires_meta_verification = true where code = r.code;
      perform private.write_audit('SERVICE_META_VERIFICATION_SET', 'crm_service', null, null, null,
        jsonb_build_object('code', r.code, 'before', false, 'after', true, 'source', 'migration 20261231000100'));
    end if;
  end loop;
end $$;

create or replace function private.service_needs_meta_verifier(p_service text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.requires_meta_verification or s.meta_verifier_onboarding from public.crm_services s where s.code = p_service), false)
$$;
revoke all on function private.service_needs_meta_verifier(text) from public, anon, authenticated;

-- a customer with at least one of the Messaging services the Meta Verifier onboards
create or replace function private.messaging_onboarding_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                  where cs.customer_id = p_customer and (s.meta_verifier_onboarding or s.requires_meta_verification))
$$;
revoke all on function private.messaging_onboarding_customer(uuid) from public, anon;
grant execute on function private.messaging_onboarding_customer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The route follows the services
-- ---------------------------------------------------------------------------
create or replace function private.computed_route(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                            where cs.customer_id = p_customer and (s.requires_meta_verification or s.meta_verifier_onboarding)) then 'META' else 'TECHNICAL' end
$$;
revoke all on function private.computed_route(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Messaging customers already in verification with the Technical Consultant move to the Meta Verifier (where one exists)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.id, c.department_id, c.team_id, o.verification_route
      from public.customers c join public.customer_onboarding o on o.customer_id = c.id
     where c.lifecycle_stage = 'ONBOARDING' and o.forwarded_to_support_at is not null and o.handover_stage = 'CONSULTANT'
       and o.verification_route = 'TECHNICAL'
       and private.messaging_onboarding_customer(c.id)
       and exists (select 1 from public.profiles p where p.status = 'ACTIVE' and p.is_meta_verifier and private.verifier_covers(p.id, c.department_id))
  loop
    update public.customer_onboarding set verification_route = 'META' where customer_id = r.id;
    perform private.log_customer_activity(r.id, 'VERIFICATION_REROUTED',
      'Initial onboarding of the Messaging service moved to the Meta Verifier (WhatsApp / Blue Tick / RCS onboarding is the Meta Verifier''s). Documents keep their review state.');
    perform private.write_audit('VERIFICATION_REROUTED', 'customer', r.id, r.department_id, r.team_id,
      jsonb_build_object('route', 'META', 'previousRoute', r.verification_route, 'reason', 'Messaging services are onboarded by the Meta Verifier', 'source', 'migration 20261231000100'));
    perform private.wf_refresh(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. "Meta verification completed" is not the Technical Consultant's for a Messaging customer
-- ---------------------------------------------------------------------------
create or replace function public.mark_meta_verification_completed(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
begin
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not (private.is_super_admin()
       or (private.my_role() = 'DEPARTMENT_HEAD' and v.department_id = private.my_department_id())
       or (private.can_consult_customer(p_customer) and not private.messaging_onboarding_customer(p_customer))
       or private.can_review_onboarding(p_customer)) then
    if private.can_consult_customer(p_customer) then
      raise exception 'FORBIDDEN: The Meta Verifier completes the initial onboarding of this Messaging customer.' using errcode = '42501';
    end if;
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or not private.automation_eligible(p_customer) then
    raise exception 'CONFLICT: This customer has no Meta verification to complete.' using errcode = 'P0001';
  end if;
  if o.meta_completed_at is not null then
    return; -- already recorded: nothing is sent twice
  end if;
  if private.client_status_rank(coalesce(o.client_status, '')) < private.client_status_rank('META_VERIFICATION') then
    raise exception 'CONFLICT: Meta verification can be completed only after the documents are verified and the application is submitted.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set meta_completed_at = now(), meta_completed_by = (select private.my_id()) where customer_id = p_customer;
  perform private.advance_client_status(p_customer, false);
  perform private.log_customer_activity(p_customer, 'META_VERIFICATION_COMPLETED', 'Meta verification marked as completed');
  perform private.write_audit('META_VERIFICATION_COMPLETED', 'customer', p_customer, v.department_id, v.team_id, '{}'::jsonb);
end $$;
revoke all on function public.mark_meta_verification_completed(uuid) from public, anon;
grant execute on function public.mark_meta_verification_completed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Technical Consultant's status no longer claims the initial verification of a META-route customer
-- ---------------------------------------------------------------------------
create or replace function private.wf_tc_derive(p_customer uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  ladder constant text[] := array['NEW_LEAD', 'VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS', 'ADDON_SERVICES_RECOMMENDED',
                                  'WAITING_FOR_CUSTOMER_PURCHASE', 'PAYMENT_CONFIRMATION_PENDING', 'ADDON_PURCHASED', 'TECHNICAL_PROCESSING'];
  o public.customer_onboarding;
  r public.addon_requests;
  v_vp integer;
  v_ap integer := 0;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if o.customer_id is null or not o.with_consultant then return 'NEW_LEAD'; end if;
  if o.handover_stage <> 'CONSULTANT' then
    -- the first verification is finished: nothing bought yet. The consultant still has the add-ons to offer (or the customer declined).
    v_vp := case when o.addons_required is false then 4 else 3 end;
  elsif private.onboarding_route(p_customer) = 'META' then
    -- the Meta Verifier does the initial verification: for the consultant this is a customer to consult (New lead), not a verification
    v_vp := 0;
  elsif o.items_verified > 0 or o.items_rejected > 0 or o.returned_at is not null or o.consultant_started_at is not null then
    v_vp := 2;
  else
    v_vp := 1;
  end if;
  select * into r from public.addon_requests where customer_id = p_customer order by created_at desc, id desc limit 1;
  if r.id is not null and r.status not in ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED') then
    v_ap := case r.status
      when 'PENDING_VERIFICATION' then 4
      when 'APPROVED' then 4
      when 'INVOICE_GENERATED' then case when exists (select 1 from public.addon_payments pp where pp.request_id = r.id and pp.status = 'PENDING') then 5 else 4 end
      when 'PAYMENT_CONFIRMED' then 6
      else 7 end;
  end if;
  return ladder[greatest(v_vp, v_ap) + 1];
end $$;
revoke all on function private.wf_tc_derive(uuid) from public, anon, authenticated;

create or replace function private.tg_workflow_tc_no_meta_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tc_changed_by is not null and new.tc_status is distinct from old.tc_status
     and new.tc_status in ('VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS')
     and private.onboarding_route(new.customer_id) = 'META' then
    raise exception 'FORBIDDEN: The Meta Verifier handles the initial verification of this customer; the Technical Consultant track is consultation and add-ons.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_workflow_tc_no_meta_verification() from public, anon, authenticated;
drop trigger if exists customer_workflow_tc_no_meta_verification on public.customer_workflow_status;
create trigger customer_workflow_tc_no_meta_verification before update on public.customer_workflow_status
  for each row execute function private.tg_workflow_tc_no_meta_verification();

-- re-derive the Technical Consultant status of the customers on the META route that are still in verification (a status a person set stays,
-- as wf_refresh always does, unless the records changed)
do $$
declare
  r record;
begin
  for r in select o.customer_id from public.customer_onboarding o join public.customer_workflow_status w on w.customer_id = o.customer_id
            where o.handover_stage = 'CONSULTANT' and o.with_consultant and private.onboarding_route(o.customer_id) = 'META'
              and w.tc_status in ('VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS') loop
    perform private.wf_refresh(r.customer_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Mixed customers: the items of the separately bought TECHNICAL-track services stay the Technical Consultant's
-- ---------------------------------------------------------------------------
-- An item the Technical Consultant may still authorize on a META-route customer: one that only that customer's TECHNICAL-track (non-Messaging)
-- services ask for. Items every customer gives (always required) and items a Messaging service asks for belong to the Meta Verifier.
create or replace function private.tc_owns_onboarding_item(p_customer uuid, p_item text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.onboarding_route(p_customer) = 'META'
     and exists (select 1 from public.customers c where c.id = p_customer and c.lifecycle_stage = 'ONBOARDING'
                    and c.department_id = private.my_support_department_id()
                    and private.onboarding_forwarded(c.id)
                    and not exists (select 1 from public.customer_onboarding o where o.customer_id = c.id and (o.handover_stage <> 'CONSULTANT' or o.returned_at is not null)))
     and exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_technical_consultant)
     and not coalesce((select i.always_required from public.onboarding_items i where i.code = p_item), true)
     and exists (select 1 from public.onboarding_item_services m join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
                  join public.crm_services s on s.code = m.service_code
                  where m.item_code = p_item and s.requires_technical_consultant and not s.requires_meta_verification and not s.meta_verifier_onboarding)
     and not exists (select 1 from public.onboarding_item_services m join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
                      join public.crm_services s on s.code = m.service_code
                      where m.item_code = p_item and (s.requires_meta_verification or s.meta_verifier_onboarding))
$$;
revoke all on function private.tc_owns_onboarding_item(uuid, text) from public, anon;
grant execute on function private.tc_owns_onboarding_item(uuid, text) to authenticated, service_role;

create or replace function public.review_onboarding_entry(p_customer uuid, p_item text, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  i public.onboarding_items;
  e public.customer_onboarding_entries;
  o public.customer_onboarding;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_direct boolean := private.can_verify_direct_documents(p_customer);
  v_tc_item boolean := private.tc_owns_onboarding_item(p_customer, p_item);
begin
  if not (private.can_review_onboarding(p_customer) or v_direct or v_tc_item) then
    if private.can_consult_customer(p_customer) and private.onboarding_route(p_customer) = 'META' then
      raise exception 'FORBIDDEN: The Meta Verifier authorizes the initial onboarding documents of this Messaging customer.' using errcode = '42501';
    end if;
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_decision not in ('VERIFIED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose verify or reject.' using errcode = 'P0001';
  end if;
  if p_decision = 'REJECTED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Tell the sales team what needs fixing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into i from public.onboarding_items where code = p_item;
  select * into e from public.customer_onboarding_entries where customer_id = p_customer and item_code = p_item for update;
  if e.item_code is null then
    raise exception 'CONFLICT: Nothing has been saved for this item yet.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding_entries
     set status = p_decision, reviewed_by = (select private.my_id()), reviewed_at = now(), review_note = left(v_note, 1000)
   where customer_id = p_customer and item_code = p_item;
  perform private.refresh_onboarding_progress(p_customer);

  perform private.log_customer_activity(p_customer,
    case when p_decision = 'VERIFIED' then 'ONBOARDING_ITEM_VERIFIED' else 'ONBOARDING_ITEM_REJECTED' end,
    case when p_decision = 'VERIFIED' then format('%s verified', i.label) else format('%s needs fixing: %s', i.label, v_note) end);
  perform private.write_audit(case when p_decision = 'VERIFIED' then 'ONBOARDING_ITEM_VERIFIED' else 'ONBOARDING_ITEM_REJECTED' end,
    'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('item', p_item, 'note', v_note, 'by', case when v_direct then 'SALES' when v_tc_item and not private.can_review_onboarding(p_customer) then 'TECHNICAL_CONSULTANT_SERVICE_ITEM' else 'CONSULTANT' end));

  select * into o from public.customer_onboarding where customer_id = p_customer;
  if p_decision = 'VERIFIED' and o.items_total > 0 and o.items_verified = o.items_total then
    perform private.notify(v.owner_id, 'ONBOARDING_VERIFIED', format('Onboarding verified: %s', coalesce(v.company, v.name)),
      case when v_direct then 'Every document and detail is verified. You can send the services to their department.'
           else 'All documents and details were verified by the technical team.' end, 'customer', p_customer);
  end if;
end $$;
revoke all on function public.review_onboarding_entry(uuid, text, text, text) from public, anon;
grant execute on function public.review_onboarding_entry(uuid, text, text, text) to authenticated;

-- What the screen may offer the caller on a customer in verification (the database decides each action again)
create or replace function public.onboarding_review_scope(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_full boolean := private.can_review_onboarding(p_customer);
begin
  if not (v_full or private.can_consult_customer(p_customer) or private.can_view_onboarding_review(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'route', private.onboarding_route(p_customer),
    'messaging', private.messaging_onboarding_customer(p_customer),
    'initialOwner', case when private.onboarding_route(p_customer) = 'META' then 'META_VERIFIER' else 'TECHNICAL_CONSULTANT' end,
    'canReviewAll', v_full,
    'consultantItems', coalesce((select jsonb_agg(i.code order by i.sort_order, i.code) from private.customer_items(p_customer) i
                                  where not v_full and private.tc_owns_onboarding_item(p_customer, i.code)), '[]'::jsonb));
end $$;
revoke all on function public.onboarding_review_scope(uuid) from public, anon;
grant execute on function public.onboarding_review_scope(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The panel details (platform, account ID, panel URL, the link and password e-mails) cover every Meta-Verifier-onboarded service, RCS included.
--    Generated from the latest definitions; only the service filter changes. The Client Dashboard login stays with Accounts (not touched).
-- ---------------------------------------------------------------------------
-- latest definition from 20261223000300_meta_verifier_departments.sql; only the service filter (and its message) changed
create or replace function public.panel_details_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_can boolean := private.can_manage_panel_details(p_customer);
begin
  -- readable by whoever manages it, and by the verifier's own department after the hand-over (they still need to see what was recorded)
  if not v_can and not (private.can_access_customer(p_customer)
       and exists (select 1 from public.customers c where c.id = p_customer and private.in_verifier_scope(c.department_id))) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'canEdit', v_can,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'platform', cs.platform, 'panelAccount', cs.panel_account,
                 'panelUrl', cs.panel_url,
                 -- the link e-mail: which address went out, when, and whether the saved URL is still that one
                 'link', (select jsonb_build_object('sentAt', l.sent_at, 'sentBy', (select full_name from public.profiles where id = l.sent_by),
                                   'current', l.url = cs.panel_url,
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = l.last_job))
                            from public.service_panel_links l where l.customer_id = cs.customer_id and l.service_code = cs.service_code),
                 -- whether a password was set for the customer and what happened to the e-mail that carried it (never the password itself)
                 'credentials', (select jsonb_build_object('setAt', pc.set_at, 'setBy', (select full_name from public.profiles where id = pc.set_by),
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = pc.last_job))
                                   from public.service_panel_credentials pc where pc.customer_id = cs.customer_id and pc.service_code = cs.service_code)) order by s.sort_order, s.code)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = p_customer and (s.requires_meta_verification or s.meta_verifier_onboarding)), '[]'::jsonb),
    -- the address the panel password and link are e-mailed to: the one on the customer record
    'customerEmail', (select nullif(btrim(c.email), '') from public.customers c where c.id = p_customer),
    'dashboardLogin', (select jsonb_build_object('email', a.email, 'createdAt', a.created_at) from public.customer_client_accounts a where a.customer_id = p_customer));
end $$;
revoke all on function public.panel_details_list(uuid) from public, anon;
grant execute on function public.panel_details_list(uuid) to authenticated;

-- latest definition from 20261206000300_meta_verifier_panel_details.sql; only the service filter (and its message) changed
create or replace function public.panel_details_set(p_customer uuid, p_service text, p_platform text, p_account text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
  v_account text := nullif(btrim(coalesce(p_account, '')), '');
  v_old public.customer_services;
  v_name text;
  v_changed text[] := '{}';
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v_old from public.customer_services cs
   where cs.customer_id = p_customer and cs.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = cs.service_code and (s.requires_meta_verification or s.meta_verifier_onboarding))
   for update;
  if not found then
    raise exception 'NOT_FOUND: That is not a Messaging service (WhatsApp, Blue Tick or RCS) of this customer.' using errcode = 'P0001';
  end if;
  if v_platform is not null and (length(v_platform) > 120 or v_platform !~ '^[A-Za-z0-9][A-Za-z0-9 ._/()+&-]*$') then
    raise exception 'VALIDATION_ERROR: The panel name can have letters, numbers and . _ / ( ) + & - only, up to 120 characters.' using errcode = 'P0001';
  end if;
  if v_account is not null then
    -- an account / user ID: an e-mail address or a short ID. Anything that looks like a password or a "user:password" pair is refused.
    if length(v_account) < 3 or length(v_account) > 200 or v_account !~ '^[A-Za-z0-9][A-Za-z0-9._@+-]*$' then
      raise exception 'VALIDATION_ERROR: Enter the account or user ID as an e-mail address or an ID (letters, numbers and . _ @ + - only, 3 to 200 characters, no spaces).' using errcode = 'P0001';
    end if;
    if v_account ~* '(passw|pwd|secret|token)' then
      raise exception 'VALIDATION_ERROR: This is for the account or user ID only. Never type a password here.' using errcode = 'P0001';
    end if;
  end if;

  if v_platform is distinct from v_old.platform then v_changed := array_append(v_changed, 'platform'); end if;
  if v_account is distinct from v_old.panel_account then v_changed := array_append(v_changed, 'account'); end if;
  if cardinality(v_changed) = 0 then
    return;  -- nothing changed: no write, no history
  end if;
  update public.customer_services set platform = v_platform, panel_account = v_account
   where customer_id = p_customer and service_code = p_service;
  select name into v_name from public.crm_services where code = p_service;
  perform private.log_customer_activity(p_customer, 'PANEL_DETAILS_SAVED', format('Panel login details saved for %s (%s)', v_name, array_to_string(v_changed, ', ')));
  -- which service and which kind of field - never the values
  perform private.write_audit('SERVICE_PANEL_DETAILS_SET', 'customer', p_customer,
    (select department_id from public.customers where id = p_customer), (select team_id from public.customers where id = p_customer),
    jsonb_build_object('service', p_service, 'fields', to_jsonb(v_changed)));
end $$;
revoke all on function public.panel_details_set(uuid, text, text, text) from public, anon;
grant execute on function public.panel_details_set(uuid, text, text, text) to authenticated;

-- latest definition from 20261209000500_client_panel_url.sql; only the service filter (and its message) changed
create or replace function public.panel_url_set(p_customer uuid, p_service text, p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_url text := private.clean_panel_url(p_url);
  v_old text;
  v_name text;
  v_host text;
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select cs.panel_url into v_old from public.customer_services cs
   where cs.customer_id = p_customer and cs.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = cs.service_code and (s.requires_meta_verification or s.meta_verifier_onboarding))
   for update;
  if not found then
    raise exception 'NOT_FOUND: That is not a Messaging service (WhatsApp, Blue Tick or RCS) of this customer.' using errcode = 'P0001';
  end if;
  if v_url is not distinct from v_old then
    return jsonb_build_object('changed', false, 'panelUrl', v_url);  -- nothing changed: no write, no history
  end if;
  update public.customer_services set panel_url = v_url where customer_id = p_customer and service_code = p_service;
  select name into v_name from public.crm_services where code = p_service;
  v_host := substring(coalesce(v_url, '') from '^https://([^/?#]*)');
  perform private.log_customer_activity(p_customer, 'PANEL_URL_SAVED',
    format('Client panel URL %s for %s', case when v_url is null then 'removed' when v_old is null then 'saved' else 'changed' end, v_name));
  -- which service and which host - never the full link
  perform private.write_audit('SERVICE_PANEL_URL_SET', 'customer', p_customer,
    (select department_id from public.customers where id = p_customer), (select team_id from public.customers where id = p_customer),
    jsonb_build_object('service', p_service, 'host', v_host, 'cleared', v_url is null, 'replaced', v_old is not null));
  return jsonb_build_object('changed', true, 'panelUrl', v_url);
end $$;
revoke all on function public.panel_url_set(uuid, text, text) from public, anon;
grant execute on function public.panel_url_set(uuid, text, text) to authenticated;

-- latest definition from 20261209000500_client_panel_url.sql; only the service filter (and its message) changed
create or replace function public.panel_link_send(p_customer uuid, p_service text, p_request uuid, p_resend boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  cs public.customer_services;
  v_name text;
  v_email text;
  v_key text;
  v_prev text;
  v_job uuid;
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_request is null then
    raise exception 'VALIDATION_ERROR: The request id is missing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into cs from public.customer_services x
   where x.customer_id = p_customer and x.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = x.service_code and (s.requires_meta_verification or s.meta_verifier_onboarding)) for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: That is not a Messaging service (WhatsApp, Blue Tick or RCS) of this customer.' using errcode = 'P0001';
  end if;
  if cs.panel_url is null then
    raise exception 'VALIDATION_ERROR: Save the panel URL first.' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(v.email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: The customer has no valid e-mail address on the record. Ask Accounts to correct it, then send the panel link.' using errcode = 'P0001';
  end if;
  select name into v_name from public.crm_services where code = p_service;

  -- the same link for the same customer and service is one e-mail; a failed or skipped one may be sent again, a sent one only on purpose
  v_key := format('PANELLINK|%s|%s|%s', p_customer, p_service, md5(cs.panel_url));
  select j.status into v_prev from public.automation_jobs j where j.dedupe_key = v_key;
  if v_prev in ('QUEUED', 'SENDING') or (v_prev = 'SENT' and not coalesce(p_resend, false)) then
    return jsonb_build_object('queued', false, 'replayed', true, 'reason', case when v_prev = 'SENT' then 'ALREADY_SENT' else 'IN_PROGRESS' end);
  end if;
  if v_prev is not null then
    v_key := v_key || '|' || p_request::text;
  end if;
  insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, created_by)
  values (p_customer, 'EMAIL', 'PANEL_LINK', v_key,
          jsonb_strip_nulls(jsonb_build_object('service', p_service, 'serviceName', v_name, 'panel', cs.platform, 'panelUrl', cs.panel_url)),
          (select private.my_id()))
  on conflict (dedupe_key) do nothing
  returning id into v_job;
  if v_job is null then
    return jsonb_build_object('queued', false, 'replayed', true, 'reason', 'REPEATED_REQUEST');
  end if;
  insert into public.service_panel_links (customer_id, service_code, url, sent_at, sent_by, last_job)
  values (p_customer, p_service, cs.panel_url, now(), (select private.my_id()), v_job)
  on conflict (customer_id, service_code) do update set url = excluded.url, sent_at = now(), sent_by = excluded.sent_by, last_job = excluded.last_job;
  perform private.log_customer_activity(p_customer, 'PANEL_LINK_SENT', format('Panel link for %s e-mailed to the customer', v_name));
  perform private.write_audit('SERVICE_PANEL_LINK_SENT', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('service', p_service, 'resend', coalesce(p_resend, false)));
  return jsonb_build_object('queued', true, 'replayed', false);
end $$;
revoke all on function public.panel_link_send(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.panel_link_send(uuid, text, uuid, boolean) to authenticated;

-- latest definition from 20261208000300_client_credentials.sql; only the service filter (and its message) changed
create or replace function public.panel_credentials_send(p_customer uuid, p_service text, p_secret text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  cs public.customer_services;
  v_name text;
  v_job uuid;
  v_email text;
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_request is null or nullif(p_secret, '') is null or length(p_secret) > 2000 then
    raise exception 'VALIDATION_ERROR: The password is missing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into cs from public.customer_services x
   where x.customer_id = p_customer and x.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = x.service_code and (s.requires_meta_verification or s.meta_verifier_onboarding)) for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: That is not a Messaging service (WhatsApp, Blue Tick or RCS) of this customer.' using errcode = 'P0001';
  end if;
  if cs.panel_account is null then
    raise exception 'VALIDATION_ERROR: Save the account / user ID of this panel first.' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(v.email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: The customer has no valid e-mail address on the record. Ask Accounts to correct it, then send the panel login.' using errcode = 'P0001';
  end if;
  select name into v_name from public.crm_services where code = p_service;
  insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, secret, created_by)
  values (p_customer, 'EMAIL', 'PANEL_CREDENTIALS', format('PANEL|%s|%s|%s', p_customer, p_service, p_request),
          jsonb_strip_nulls(jsonb_build_object('service', p_service, 'serviceName', v_name, 'panel', cs.platform, 'account', cs.panel_account)),
          p_secret, (select private.my_id()))
  on conflict (dedupe_key) do nothing
  returning id into v_job;
  if v_job is null then
    return jsonb_build_object('queued', false, 'replayed', true);  -- the same request again: nothing more is sent
  end if;
  insert into public.service_panel_credentials (customer_id, service_code, set_at, set_by, last_job)
  values (p_customer, p_service, now(), (select private.my_id()), v_job)
  on conflict (customer_id, service_code) do update set set_at = now(), set_by = excluded.set_by, last_job = excluded.last_job;
  perform private.log_customer_activity(p_customer, 'PANEL_CREDENTIALS_SET', format('Panel password set for %s and e-mailed to the customer', v_name));
  -- which service - never the password
  perform private.write_audit('SERVICE_PANEL_CREDENTIALS_SET', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('service', p_service));
  return jsonb_build_object('queued', true, 'replayed', false);
end $$;
revoke all on function public.panel_credentials_send(uuid, text, text, uuid) from public, anon;
grant execute on function public.panel_credentials_send(uuid, text, text, uuid) to authenticated;
