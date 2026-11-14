-- Customers: who may SEE which customer, answered once per query instead of once per row.
--
-- WHY. The six row-security rules on public.customers (customers_select, _delivery, _handover, _review, _dh_handover, _support) are OR'd together
-- and several of them called a helper function FOR EVERY ROW of the table (sales_scope_team -> active_head_division, lead_sees -> led_by ->
-- direct_lead_of, delivery_recipient, handover_recipient). Each call is a SECURITY DEFINER function with its own search_path, and several look the
-- caller up again, so a Department Head / Team Head / Team Member paid for EVERY customer in the company, not only the ones they can see.
-- Measured on 101,222 customers (PostgreSQL 16, one connection, the API's own queries run under row security):
--   Department Head   customer count 27,343 ms -> 39 ms   first page 29,005 ms -> 37 ms   search 95,263 ms -> 459 ms
--   Team Member       pipeline counts 20,098 ms -> 50 ms
--   Super Admin       pipeline counts  4,187 ms -> 85 ms
--
-- WHAT. Three rules are re-expressed so that everything that depends only on the CALLER is looked up once (an initplan) and everything that depends
-- on the ROW is a plain comparison or a membership test against a set computed once:
--   * delivery_recipient(id)   -> id in (select private.delivery_customer_ids())
--   * handover_recipient(id)   -> id in (select private.handover_customer_ids())
--   * sales_scope_team(team)   -> team_id is null or no active division or team_id in (select private.sales_scope_team_ids())
--   * lead_sees(team, owner)   -> team_id = my team and (owner is null or owner = me or owner in (select private.led_owner_ids()))
-- Each helper returns exactly the rows for which the old per-row function was true. NOTHING about who may see what changes: the old functions are
-- left in place, and supabase/tests/customers_rls_equivalence_test.sql proves, for every test user, that the new rules show exactly the same
-- customers as the old logic (it stays in the suite so a later change cannot drift). customers_select_review / _dh_handover / _support are unchanged.
--
-- public.customer_pipeline_counts() (the pipeline tabs' counters) is redefined the same way: it called private.can_access_customer(c.id) for every
-- customer; it now applies the same rule on the row itself. Same signature, same result, same grants.
--
-- Safe to run twice (create or replace / alter policy ... using). No data is touched. To roll back: re-create the three policies from
-- 20261120*_ and the old customer_pipeline_counts() from its last migration (the old functions still exist).

create or replace function private.delivery_customer_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  -- the customers for which private.delivery_recipient(customer) is true
  select cs.customer_id from public.customer_services cs
   where cs.sent_to_delivery_at is not null
     and (private.is_super_admin() or cs.delivery_department_id = (select private.my_department_id()))
$$;

create or replace function private.handover_customer_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  -- the customers for which private.handover_recipient(customer) is true
  select o.customer_id from public.customer_onboarding o
   where (o.team_lead_id = (select private.my_id()) and o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER'))
      or (o.team_member_id = (select private.my_id()) and o.handover_stage = 'TEAM_MEMBER')
$$;

create or replace function private.sales_scope_team_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  -- the teams of the Department Head's active division (private.sales_scope_team(team) is true for these, for no team, or when there is no division)
  select t.id from public.teams t where t.division::text = private.active_head_division()
$$;

create or replace function private.led_owner_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  -- the team members whose direct lead is the caller. private.led_by(my_id, person) is true for exactly: no person, the caller, or one of these.
  select m.id from public.profiles m
   where m.role = 'TEAM_MEMBER' and m.team_id is not null
     and (select private.my_id()) is not null
     and private.direct_lead_of(m.id) is not distinct from (select private.my_id())
$$;

revoke all on function private.delivery_customer_ids(), private.handover_customer_ids(), private.sales_scope_team_ids(), private.led_owner_ids() from public, anon;
grant execute on function private.delivery_customer_ids(), private.handover_customer_ids(), private.sales_scope_team_ids(), private.led_owner_ids() to authenticated;

alter policy customers_select on public.customers using (
  ((select private.my_role()) = 'SUPER_ADMIN'::app_role)
  or (((select private.my_role()) = 'DEPARTMENT_HEAD'::app_role)
      and department_id = (select private.my_department_id())
      and (team_id is null or (select private.active_head_division()) is null or team_id in (select private.sales_scope_team_ids())))
  or (((select private.my_role()) = 'TEAM_HEAD'::app_role)
      and team_id = (select private.my_team_id())
      and (owner_id is null or owner_id = (select private.my_id()) or owner_id in (select private.led_owner_ids())))
  or (((select private.my_role()) = 'TEAM_MEMBER'::app_role) and owner_id = (select private.my_id()))
);

alter policy customers_select_delivery on public.customers using (id in (select private.delivery_customer_ids()));

alter policy customers_select_handover on public.customers using (
  lifecycle_stage = any (array['ONBOARDING', 'CUSTOMER']) and id in (select private.handover_customer_ids())
);

CREATE OR REPLACE FUNCTION public.customer_pipeline_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with c as (
    select c.id, c.lifecycle_stage, c.lead_status, c.amount_received, c.payment_due_date, c.fully_paid, c.payment_workflow,
           c.payment_status,
           coalesce(o.items_saved, 0) as saved, coalesce(o.items_total, 0) as total,
           o.returned_at is not null as returned, coalesce(o.get_started, false) as get_started
    from public.customers c
    left join public.customer_onboarding o on o.customer_id = c.id
    where c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING', 'CUSTOMER')
      -- the caller's role / department / team / id, looked up ONCE per call (as initplans), not once per customer row:
      -- the same rule as private.can_access_customer(c.id), written on the row itself
      and ((select private.my_role()) = 'SUPER_ADMIN'
        or ((select private.my_role()) = 'DEPARTMENT_HEAD' and c.department_id = (select private.my_department_id()))
        or ((select private.my_role()) = 'TEAM_HEAD' and c.team_id = (select private.my_team_id()) and (c.owner_id is null or c.owner_id = (select private.my_id()) or c.owner_id in (select private.led_owner_ids())))
        or ((select private.my_role()) = 'TEAM_MEMBER' and c.owner_id = (select private.my_id())))
  ), m as (select count(*) as n from public.document_types where is_mandatory)
  select jsonb_build_object(
    'leads', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION'),
      'NEW', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'NEW'),
      'CONTACTED', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'CONTACTED'),
      'INTERESTED', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'INTERESTED'),
      'READY_TO_BUY', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'READY_TO_BUY'),
      'WITH_ACCOUNTS', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow = 'PENDING_PAYMENT_CONFIRMATION'),
      'RETURNED', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow = 'RETURNED_FROM_ACCOUNTS')),
    'potential', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
      'AWAITING', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and amount_received = 0 and payment_due_date >= current_date),
      'PART_PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and amount_received > 0 and payment_due_date >= current_date),
      'OVERDUE', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and payment_due_date < current_date),
      'PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and fully_paid)),
    'onboarding', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
      'RETURNED', count(*) filter (where lifecycle_stage = 'ONBOARDING' and returned),
      'WAITING_ON_CLIENT', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and saved = 0),
      'COLLECTING', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and saved > 0 and saved < total),
      'READY_FOR_HANDOVER', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and total > 0 and saved >= total),
      -- Documents verified + a verified part/full payment + through Accounts (calculated by the database).
      'GET_STARTED', count(*) filter (where lifecycle_stage = 'ONBOARDING' and get_started)),
    'partPayments', count(*) filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and payment_status = 'PARTIALLY_PAID'
                      and exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED' and p.payment_type = 'PART')),
    'mandatoryDocuments', (select n from m))
  from c
$function$

;
