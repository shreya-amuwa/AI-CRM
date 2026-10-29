-- Sales sends a WhatsApp-related customer to the Meta Verifier, and says so.
--
-- What was wrong: the routing itself already existed (crm_services.requires_meta_verification -> customer_onboarding.verification_route, a
-- route-aware review check, a Meta Verifier queue), but nothing told Sales: the button always said "Send to Technical Consultant", a repeat
-- send answered "Already sent to the Technical Consultant" for a Meta customer, and a department without a Meta Verifier was only discovered
-- AFTER the click. The standalone Blue Tick service was also not on the Meta route.
--
-- Now: onboarding_handoff_info() tells the Sales screen where this customer will go (from the same route the database enforces) and whether
-- that person exists; the send and duplicate-send messages name the right role. The route is still decided and enforced only in the database
-- (forward_to_consultant, can_review_onboarding); the screen only reads it. Safe to run again.

-- Blue Tick is verified by Meta as well (the catalogue is data: Super Admin can still switch it in Workflow settings)
update public.crm_services set requires_meta_verification = true
 where code = 'BLUE_TICK' and not requires_meta_verification
   -- unless the Super Admin has already decided it either way
   and not exists (select 1 from public.audit_logs a where a.action = 'SERVICE_META_VERIFICATION_SET' and a.metadata ->> 'code' = 'BLUE_TICK');

-- Where will this customer go, and is anybody there to receive it
create or replace function public.onboarding_handoff_info(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.customers;
  v_route text;
begin
  if not private.can_access_customer(p_id) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_id;
  v_route := private.onboarding_route(p_id);
  return jsonb_build_object(
    'route', v_route,
    'recipient', case when v_route = 'META' then 'Meta Verifier' else 'Technical Consultant' end,
    'recipientAvailable', exists (
      select 1 from public.profiles p join public.teams t on t.id = p.team_id
       where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
         and case when v_route = 'META' then p.is_meta_verifier else p.is_technical_consultant end));
end $$;
revoke all on function public.onboarding_handoff_info(uuid) from public, anon;
grant execute on function public.onboarding_handoff_info(uuid) to authenticated;

-- Sales' send: the same checks as before; only the wording follows the route
create or replace function public.forward_onboarding_to_support(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  o public.customer_onboarding;
  v_missing text;
  v_recipient uuid;
  v_who text := case when private.onboarding_route(p_id) = 'META' then 'Meta Verifier' else 'Technical Consultant' end;
begin
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_id;
  if o.forwarded_to_support_at is not null then
    raise exception 'CONFLICT: Already sent to the %.', v_who using errcode = 'P0001';
  end if;
  if o.sent_to_accounts_at is not null and o.accounts_confirmed_at is null then
    raise exception 'CONFLICT: Already sent to Accounts. Waiting for their confirmation.' using errcode = 'P0001';
  end if;
  select string_agg(i.label, ', ' order by i.sort_order) into v_missing
  from private.customer_items(p_id) i
  where not exists (select 1 from public.customer_onboarding_entries e
                    where e.customer_id = p_id and e.item_code = i.code and e.status in ('SAVED', 'VERIFIED'));
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: Complete these items first: %.', v_missing using errcode = 'P0001';
  end if;

  -- Amount already confirmed (the verifier sent it back): no second round with Accounts.
  if o.accounts_confirmed_at is not null then
    perform private.forward_to_consultant(p_id, v, o.returned_at is not null);
    return;
  end if;

  update public.customer_onboarding
     set sent_to_accounts_at = now(), sent_to_accounts_by = (select private.my_id())
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'SENT_TO_ACCOUNTS', 'Sent to Accounts to confirm the amount');
  perform private.write_audit('ONBOARDING_SENT_TO_ACCOUNTS', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('deal_amount', v.deal_amount, 'amount_received', v.amount_received));

  for v_recipient in
    select p.id from public.profiles p join public.departments d on d.id = p.department_id
    where p.status = 'ACTIVE' and d.slug = 'accounts'
  loop
    perform private.notify(v_recipient, 'SENT_TO_ACCOUNTS', format('Confirm the amount: %s', coalesce(v.company, v.name)),
      'Sales sent a new customer for payment confirmation.', 'customer', p_id);
  end loop;
end $$;
revoke all on function public.forward_onboarding_to_support(uuid) from public, anon;
grant execute on function public.forward_onboarding_to_support(uuid) to authenticated;

notify pgrst, 'reload schema';
