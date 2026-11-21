-- =============================================================================
-- Department Head "Add lead": who a head may give a new lead to, for the Sales side AND the Support side
-- =============================================================================
-- 20270125000100_department_head_dashboard.sql offered no one to a Support-side head ("leads belong to the Sales side"). The Support team adds leads too (the Support
-- Team Lead has the same lead pages), so a head of either side is now offered: themself, and the active Team Leads and Team Members of THEIR side of the department
-- that the existing rule allows (private.can_assign_customer_owner, which the customer insert checks again). A head with no side set is offered every team of the
-- department. Only this one function is replaced (create or replace, safe to run twice); nothing else changes and no data is touched.
-- Needs 20270125000100_department_head_dashboard.sql (private.head_dept).
-- =============================================================================
create or replace function public.head_lead_owners()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.head_dept();
  v_me uuid := private.my_id();
  v_side text := private.active_head_division();
begin
  return coalesce((
    select jsonb_agg(o.item order by o.ord, o.name)
      from (
        select 0 as ord, p.full_name as name,
               jsonb_build_object('id', p.id, 'name', p.full_name, 'team', null, 'role', 'Myself', 'designation', 'Department Head') as item
          from public.profiles p where p.id = v_me and private.can_assign_customer_owner(p.id)
        union all
        select case p.role when 'TEAM_HEAD' then 1 else 2 end, p.full_name,
               jsonb_build_object('id', p.id, 'name', p.full_name, 'team', t.name, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
                                  'designation', coalesce(nullif(p.position, ''), private.employee_snapshot(p.id) ->> 'designation'))
          from public.profiles p join public.teams t on t.id = p.team_id
         where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.department_id = v_dept
           and (v_side is null or t.division::text = v_side)
           and private.can_assign_customer_owner(p.id)) o), '[]'::jsonb);
end $$;

revoke all on function public.head_lead_owners() from public, anon;
grant execute on function public.head_lead_owners() to authenticated, service_role;
notify pgrst, 'reload schema';
