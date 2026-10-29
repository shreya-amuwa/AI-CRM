-- Department Head "Client hand-overs": a customer the Meta Verifier sends is visible to the Department Head at once.
--
-- ROOT CAUSE (reproduced with a Support-side head in the test suite before this change: the head saw 0 of 2 handed-over customers).
-- The hand-over itself already worked: send_to_department_head() sets handover_stage = 'DEPARTMENT_HEAD', notifies the head and schedules the
-- Technical Consultant's follow-up as a separate task. But the Department Head could not READ the customer afterwards. The only policy that lets
-- a Department Head read customers (customers_select) is limited to customers whose OWNING team is of the head's own division
-- (sales_scope_team(team_id)). Customers are owned by Sales teams, and a Support-side head (the side that receives hand-overs) therefore got an
-- empty "Client hand-overs" queue: "No verified customers yet". customers_select_handover only covers the Team Lead / Team Member the customer
-- was passed to. The page text ("customers the Technical Consultant has verified ... once the Technical Consultant sends them to you") was also
-- from the old workflow.
--
-- This migration:
--   1. lets a Department Head read the customers HANDED OVER in their (active) department - every customer whose handover_stage is past the
--      verification stage - when they work on the Support side or have no side. Nothing about the verification stage changes, a Sales-side head
--      gets no new access, and nothing depends on the Technical Consultant;
--   2. sends the hand-over notice to the Support-side heads of the customer's department (including heads authorised for it through
--      department_access), falling back to every active head when the department has no Support-side head (so a hand-over is never blocked);
--   3. tells the assigned Technical Consultant, once, that a consultation follow-up exists (the follow-up itself is unchanged: one per customer,
--      created in the same transaction, with the Super Admin's delay);
--   4. shows on the customer's hand-over detail which route verified it and the state of the consultation follow-up;
--   5. adds a reconciliation report for customers caught in the old workflow and ONE explicit, audited action that creates the follow-ups that
--      are missing. Nothing is changed by running this migration.
-- It needs 20261209000100_client_onboarding_journey.sql (send_to_department_head below keeps that migration's "Meta verification first" check). Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Visibility
-- ---------------------------------------------------------------------------
create or replace function private.customer_handed_over(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer and o.handover_stage <> 'CONSULTANT')
$$;
revoke all on function private.customer_handed_over(uuid) from public, anon;
grant execute on function private.customer_handed_over(uuid) to authenticated, service_role;

drop policy if exists customers_select_dh_handover on public.customers;
create policy customers_select_dh_handover on public.customers for select to authenticated
  using ((select private.my_role()) = 'DEPARTMENT_HEAD'
         and lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
         and department_id = (select private.my_department_id())
         and coalesce((select private.active_head_division()), 'SUPPORT') = 'SUPPORT'
         and private.customer_handed_over(id));

-- ---------------------------------------------------------------------------
-- 2. Who is told about a hand-over
-- ---------------------------------------------------------------------------
create or replace function private.handover_head_recipients(p_department uuid)
returns table (profile_id uuid)
language sql stable security definer set search_path = '' as $$
  with support as (select r.profile_id from private.department_head_recipients(p_department, 'SUPPORT') r)
  select s.profile_id from support s
  union all
  select r.profile_id from private.department_head_recipients(p_department) r where not exists (select 1 from support)
$$;
revoke all on function private.handover_head_recipients(uuid) from public, anon, authenticated;

create or replace function public.send_to_department_head(p_customer uuid, p_note text DEFAULT NULL::text)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_head uuid;
  v_count integer := 0;
  v_meta boolean;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  if o.handover_stage <> 'CONSULTANT' then
    raise exception 'CONFLICT: Already sent to the Department Head.' using errcode = 'P0001';
  end if;
  if o.returned_at is not null or o.review_state <> 'VERIFIED' then
    raise exception 'VALIDATION_ERROR: Authorize every document and detail first (including the WABA ID where it applies).' using errcode = 'P0001';
  end if;
  v_meta := private.onboarding_route(p_customer) = 'META';
  -- the Relationship Manager takes over only after Meta verification (the onboarding journey, 20261209000100): that check is kept as it was
  if private.meta_required(p_customer) and o.meta_status <> 'COMPLETED' and o.meta_completed_at is null then
    raise exception 'VALIDATION_ERROR: Complete the Meta verification first. The Relationship Manager takes over only after it.' using errcode = 'P0001';
  end if;

  -- the heads of the customer's own department (read from the customer record, never from the request)
  select count(*) into v_count from private.handover_head_recipients(v.department_id);
  if v_count = 0 then
    raise exception 'CONFLICT: This department has no active Department Head to send the customer to.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'DEPARTMENT_HEAD', stage = 'HANDOVER', to_department_head_at = now(),
         to_department_head_by = (select private.my_id()), handover_note = v_note
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_DEPARTMENT_HEAD', 'Verified and sent to the Department Head' || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_DEPARTMENT_HEAD', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('note', v_note, 'route', case when v_meta then 'META' else 'TECHNICAL' end));
  -- the Technical Consultant's consultation is a separate task that follows some days later (a persistent follow-up; the delay is a setting).
  -- It never holds the customer back from the Department Head.
  if v_meta then
    perform private.schedule_tc_followup(p_customer, 'The Meta Verifier verified the customer and handed it over. Contact the customer for the consultation and any add-on services.');
  end if;

  for v_head in select profile_id from private.handover_head_recipients(v.department_id) loop
    perform private.notify(v_head, 'HANDOVER_TO_DEPARTMENT_HEAD', format('New client to assign: %s', coalesce(v.company, v.name)),
      coalesce(v_note, case when v_meta then 'The Meta Verifier verified everything.' else 'The Technical Consultant verified everything.' end), 'customer', p_customer);
  end loop;
  perform private.notify(v.owner_id, 'HANDOVER_TO_DEPARTMENT_HEAD', format('Verified: %s', coalesce(v.company, v.name)),
    case when v_meta then 'The Meta Verifier verified the customer and sent it to the Department Head.' else 'The Technical Consultant verified the customer and sent it to the Department Head.' end, 'customer', p_customer);
end $function$;
revoke all on function public.send_to_department_head(uuid, text) from public, anon;
grant execute on function public.send_to_department_head(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The follow-up: unchanged, plus one notice to the consultant it is assigned to (only when it is newly created)
-- ---------------------------------------------------------------------------
create or replace function private.schedule_tc_followup(p_customer uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_days integer;
  v_id uuid;
  v_to uuid;
begin
  select * into v from public.customers where id = p_customer;
  if v.id is null or v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') or v.department_id is null then
    return;
  end if;
  select w.tc_followup_delay_days into v_days from public.workflow_settings w where w.id;
  insert into public.tc_followups (customer_id, department_id, assigned_to, status, reason, eligible_at, due_at)
  values (p_customer, v.department_id, private.pick_consultant(v.department_id),
          case when v_days is null then 'AWAITING_CONFIGURATION' else 'SCHEDULED' end, left(p_reason, 500), now(),
          case when v_days is null then null else now() + make_interval(days => v_days) end)
  on conflict (customer_id) where status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE') do nothing
  returning id, assigned_to into v_id, v_to;
  if v_id is null then
    return;                                                     -- already scheduled: nothing is created or notified twice
  end if;
  perform private.log_customer_activity(p_customer, 'TC_FOLLOWUP_SCHEDULED',
    case when v_days is null then 'Technical Consultant follow-up waits for the delay to be set' else format('Technical Consultant follow-up scheduled in %s day(s)', v_days) end);
  perform private.write_audit('TC_FOLLOWUP_SCHEDULED', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('followup_id', v_id, 'delay_days', v_days));
  if v_to is not null then
    perform private.notify(v_to, 'TC_FOLLOWUP_SCHEDULED', format('Consultation follow-up: %s', coalesce(v.company, v.name)),
      case when v_days is null then 'The customer was verified. The follow-up will get its date when the delay is set.'
           else format('The customer was verified. Contact them for the consultation in %s day(s).', v_days) end,
      'customer', p_customer);
  end if;
end $$;
revoke all on function private.schedule_tc_followup(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the hand-over detail shows: the route that verified it, and the consultation follow-up (only to people who may see follow-ups)
-- ---------------------------------------------------------------------------
create or replace function public.customer_handover_info(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  o public.customer_onboarding;
  a public.customer_client_accounts;
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  if o.customer_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'stage', o.handover_stage,
    'route', private.onboarding_route(p_customer),
    'toDepartmentHeadAt', o.to_department_head_at,
    'sentBy', (select full_name from public.profiles where id = o.to_department_head_by),
    'teamLead', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = o.team_lead_id),
    'passedToTeamLeadAt', o.passed_to_team_lead_at,
    'teamMember', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = o.team_member_id),
    'assignedToMemberAt', o.assigned_to_member_at,
    'note', o.handover_note,
    'followUp', (select jsonb_build_object('status', case when f.status = 'SCHEDULED' and f.due_at <= now() then 'DUE' else f.status end, 'dueAt', f.due_at,
                                           'assignedTo', (select p.full_name from public.profiles p where p.id = f.assigned_to))
                   from public.tc_followups f
                  where f.customer_id = p_customer and private.followup_scope(f)
                  order by (f.status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE')) desc, f.created_at desc limit 1),
    'clientAccount', case when a.customer_id is null then null
                          else jsonb_build_object('email', a.email, 'createdAt', a.created_at) end);
end $function$;
revoke all on function public.customer_handover_info(uuid) from public, anon;
grant execute on function public.customer_handover_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reconciliation of customers caught in the old workflow (a report; the one action below creates only what is missing)
-- ---------------------------------------------------------------------------
create or replace function public.handover_reconciliation_report()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or private.my_role() = 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only the Super Admin and Department Heads can see this.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    -- everything is authorized and Meta verification is complete, but nobody sent it on: it waits in the Meta Verifier's queue (the verifier, the Department Head or the Super Admin sends it)
    'verifiedNotSent', coalesce((
      select jsonb_agg(jsonb_build_object('customerId', c.id, 'customer', coalesce(c.company, c.name), 'department', d.name, 'sentForVerificationAt', o.forwarded_to_support_at) order by o.forwarded_to_support_at nulls last)
        from public.customers c join public.customer_onboarding o on o.customer_id = c.id join public.departments d on d.id = c.department_id
       where c.lifecycle_stage = 'ONBOARDING' and o.handover_stage = 'CONSULTANT' and o.forwarded_to_support_at is not null
         and o.review_state = 'VERIFIED' and o.returned_at is null and private.onboarding_route(c.id) = 'META'
         and (o.meta_status = 'COMPLETED' or o.meta_completed_at is not null)
         and (private.is_super_admin() or c.department_id = private.my_department_id())), '[]'::jsonb),
    -- handed over by a Meta Verifier but no consultation follow-up was ever made for it
    'handedOverWithoutFollowUp', coalesce((
      select jsonb_agg(jsonb_build_object('customerId', c.id, 'customer', coalesce(c.company, c.name), 'department', d.name, 'handedOverAt', o.to_department_head_at, 'stage', o.handover_stage) order by o.to_department_head_at nulls last)
        from public.customers c join public.customer_onboarding o on o.customer_id = c.id join public.departments d on d.id = c.department_id
       where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.handover_stage <> 'CONSULTANT' and private.onboarding_route(c.id) = 'META'
         and not exists (select 1 from public.tc_followups f where f.customer_id = c.id)
         and (private.is_super_admin() or c.department_id = private.my_department_id())), '[]'::jsonb));
end $$;
revoke all on function public.handover_reconciliation_report() from public, anon;
grant execute on function public.handover_reconciliation_report() to authenticated;

-- Creates the consultation follow-up for every customer in 'handedOverWithoutFollowUp'. Idempotent (one open follow-up per customer; a customer
-- that already has any follow-up is left alone), changes no customer, assignment or hand-over, and is audited.
create or replace function public.handover_reconcile_followups()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can do this.' using errcode = '42501';
  end if;
  for r in
    select c.id from public.customers c join public.customer_onboarding o on o.customer_id = c.id
     where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.handover_stage <> 'CONSULTANT' and private.onboarding_route(c.id) = 'META'
       and not exists (select 1 from public.tc_followups f where f.customer_id = c.id)
  loop
    perform private.schedule_tc_followup(r.id, 'Added by reconciliation: the customer was handed over before the consultation follow-up existed.');
    v_n := v_n + 1;
  end loop;
  perform private.write_audit('HANDOVER_FOLLOWUPS_RECONCILED', 'workflow_settings', null, null, null, jsonb_build_object('customers', v_n));
  return jsonb_build_object('customers', v_n);
end $$;
revoke all on function public.handover_reconcile_followups() from public, anon;
grant execute on function public.handover_reconcile_followups() to authenticated;

notify pgrst, 'reload schema';
