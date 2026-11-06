-- Sales of any department reaches the Meta Verifier who verifies for that department, not only a verifier placed IN it.
--
-- WHAT WAS WRONG: 20261223000300_meta_verifier_departments let one Meta Verifier verify for several departments (meta_verifier_departments), and the
-- verifier's queue, review rights and automatic assignment all honour it. But the moment Sales sends a customer on, two older checks still looked only
-- at verifiers whose OWN department is the customer's:
--   * private.forward_to_consultant refused "This department has no active Meta Verifier" when the department's verifier is placed in another
--     department, and notified only verifiers placed in the customer's department;
--   * public.onboarding_handoff_info told the Sales screen "no Meta Verifier" for the same reason.
-- So a D Talk sales person could not send a lead to the Wabastore-based verifier who covers D Talk.
--
-- WHAT THIS CHANGES: both use private.verifier_covers (the verifier's home department plus the departments added to them). The Technical Consultant
-- route and the Support Team Lead notification are unchanged. Run after 20261223000300_meta_verifier_departments.sql. Safe to run again.

create or replace function private.forward_to_consultant(p_id uuid, v public.customers, v_again boolean)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_recipient uuid;
  v_meta boolean := private.onboarding_route(p_id) = 'META';
begin
  if v_meta and not exists (select 1 from public.profiles p
                             where p.status = 'ACTIVE' and p.is_meta_verifier and private.verifier_covers(p.id, v.department_id)) then
    raise exception 'CONFLICT: No active Meta Verifier verifies for this department yet. Ask the Super Admin or the Operations Head to add this department to a Meta Verifier.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding
     set stage = 'SETUP', forwarded_to_support_at = now(), forwarded_by = (select private.my_id()),
         returned_at = null, returned_by = null, return_note = null
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'FORWARDED_TO_SUPPORT',
    case when v_again then 'Fixed and sent again to the ' else 'Sent to the ' end || case when v_meta then 'Meta Verifier' else 'Technical Consultant' end || case when v_again then '' else ' for verification' end);
  perform private.write_audit('ONBOARDING_FORWARDED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('resubmitted', coalesce(v_again, false), 'route', case when v_meta then 'META' else 'TECHNICAL' end));

  for v_recipient in
    -- the department's Support Team Leads and (other route) Technical Consultants, as before
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
    where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
      and ((not v_meta and p.is_technical_consultant) or p.role = 'TEAM_HEAD')
    union
    -- every Meta Verifier who verifies for the customer's department, wherever they are placed
    select p.id from public.profiles p
    where v_meta and p.status = 'ACTIVE' and p.is_meta_verifier and private.verifier_covers(p.id, v.department_id)
  loop
    perform private.notify(v_recipient, 'ONBOARDING_FORWARDED',
      format(case when v_again then 'Re-verify: %s' else 'New customer to verify: %s' end, coalesce(v.company, v.name)),
      case when v_again then 'Sales fixed the items you sent back.' else 'Accounts confirmed the amount. The customer''s details and documents are ready for verification.' end,
      'customer', p_id);
  end loop;
end $function$;
revoke all on function private.forward_to_consultant(uuid, public.customers, boolean) from public, anon, authenticated;

-- Where will this customer go, and is anybody there to receive it (the Sales screen)
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
    'recipientAvailable', case when v_route = 'META'
      then exists (select 1 from public.profiles p where p.status = 'ACTIVE' and p.is_meta_verifier and private.verifier_covers(p.id, v.department_id))
      else exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                    where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id and p.is_technical_consultant) end);
end $$;
revoke all on function public.onboarding_handoff_info(uuid) from public, anon;
grant execute on function public.onboarding_handoff_info(uuid) to authenticated;

notify pgrst, 'reload schema';
