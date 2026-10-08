-- =============================================================================
-- "Send to Technical Consultant".
--
-- Sales collects the customer's details and documents first. The Technical
-- Consultant sees the customer — and can authorize items or run automations —
-- only after the salesperson clicks "Send to Technical Consultant"
-- (customer_onboarding.forwarded_to_support_at). This restores the hand-off
-- that 20261008000000 had removed (department-wide visibility before sending).
--
-- Department heads and the super admin keep their normal access to their
-- customers; review actions also require the customer to have been sent.
-- Additive / idempotent.
-- =============================================================================

-- Review rights (view files, authorize / not authorize, authorize all,
-- automations) only for customers that have been sent.
create or replace function private.can_review_onboarding(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and private.onboarding_forwarded(c.id)
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()))
$$;

-- Consultants can read only the customers sent to them.
drop policy if exists customers_select_review on public.customers;
create policy customers_select_review on public.customers for select to authenticated
  using (department_id = (select private.my_support_department_id())
         and lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
         and private.onboarding_forwarded(id));

-- Same rules as before (every checklist item saved), with consultant wording.
create or replace function public.forward_onboarding_to_support(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_missing text;
  v_recipient uuid;
begin
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_onboarding where customer_id = p_id and forwarded_to_support_at is not null) then
    raise exception 'CONFLICT: Already sent to the Technical Consultant.' using errcode = 'P0001';
  end if;
  select string_agg(i.label, ', ' order by i.sort_order) into v_missing
  from private.customer_items(p_id) i
  where not exists (select 1 from public.customer_onboarding_entries e
                    where e.customer_id = p_id and e.item_code = i.code and e.status in ('SAVED', 'VERIFIED'));
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: Complete these items first: %.', v_missing using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set stage = 'SETUP', forwarded_to_support_at = now(), forwarded_by = (select private.my_id())
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'FORWARDED_TO_SUPPORT', 'Sent to the Technical Consultant for verification');
  perform private.write_audit('ONBOARDING_FORWARDED', 'customer', p_id, v.department_id, v.team_id, '{}'::jsonb);

  for v_recipient in
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
    where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
  loop
    perform private.notify(v_recipient, 'ONBOARDING_FORWARDED', format('New customer to verify: %s', coalesce(v.company, v.name)),
      'Sales has sent the customer''s details and documents for verification.', 'customer', p_id);
  end loop;
end $$;
revoke all on function public.forward_onboarding_to_support(uuid) from public, anon;
grant execute on function public.forward_onboarding_to_support(uuid) to authenticated;
