-- =============================================================================
-- The Team Leader dashboard and the client hand-over chain belong to SUPPORT.
--
--   Technical Consultant -> Department Head -> Support Team Lead -> Support Team Member
--
-- Sales Team Leads keep their own (sales) workspace and are not part of this
-- chain: the dashboard functions only answer for a Team Lead of a SUPPORT team,
-- and the Department Head can only pass a client to a Support Team Lead.
-- Additive / idempotent: functions are redefined, no data is changed.
-- =============================================================================

-- The calling Support Team Lead (active, in a SUPPORT team) or nothing.
create or replace function private.current_team_lead()
returns public.profiles language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p
  join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
  where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
$$;
revoke all on function private.current_team_lead() from public, anon;
grant execute on function private.current_team_lead() to authenticated;

create or replace function private.team_lead_scope(p_lead uuid)
returns table (customer_id uuid, handed boolean, assignee_id uuid, needs_decision boolean)
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.id, p.team_id from public.profiles p
    join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
    where p.id = p_lead and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
  ), handed as (
    select o.customer_id, o.handover_stage, o.team_member_id
    from me join public.customer_onboarding o on o.team_lead_id = me.id
    join public.customers c on c.id = o.customer_id
    where o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER') and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
  )
  select h.customer_id, true,
         case when h.handover_stage = 'TEAM_MEMBER' then h.team_member_id end,
         h.handover_stage = 'TEAM_LEAD'
  from handed h
  union all
  select c.id, false, c.owner_id, false
  from me join public.customers c on c.team_id = me.team_id
  where not exists (select 1 from handed h where h.customer_id = c.id)
$$;
revoke all on function private.team_lead_scope(uuid) from public, anon, authenticated;

create or replace function private.in_team_lead_scope(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles me
    join public.teams t on t.id = me.team_id and t.division = 'SUPPORT'
    join public.customers c on c.id = p_customer
    where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'TEAM_HEAD'
      and (c.team_id = me.team_id
        or exists (select 1 from public.customer_onboarding o
                    where o.customer_id = c.id and o.team_lead_id = me.id
                      and o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER'))))
$$;
revoke all on function private.in_team_lead_scope(uuid) from public, anon;
grant execute on function private.in_team_lead_scope(uuid) to authenticated;

-- Department Head -> Support Team Lead only.
create or replace function public.pass_to_team_lead(p_customer uuid, p_team_lead uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
begin
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not (private.is_super_admin()
       or (private.my_role() = 'DEPARTMENT_HEAD' and v.department_id = private.my_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or o.handover_stage not in ('DEPARTMENT_HEAD', 'TEAM_LEAD') then
    raise exception 'CONFLICT: This customer is not waiting to be passed to a Team Lead.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p
                  join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
                  where p.id = p_team_lead and p.role = 'TEAM_HEAD'
                    and p.status = 'ACTIVE' and p.department_id = v.department_id) then
    raise exception 'VALIDATION_ERROR: Choose an active Support Team Lead of this department.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'TEAM_LEAD', team_lead_id = p_team_lead, passed_to_team_lead_at = now(),
         passed_to_team_lead_by = (select private.my_id()), team_member_id = null, assigned_to_member_at = null,
         assigned_to_member_by = null, handover_note = coalesce(v_note, handover_note)
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'PASSED_TO_TEAM_LEAD',
    format('Passed to Team Lead %s', (select full_name from public.profiles where id = p_team_lead)) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_TEAM_LEAD', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('team_lead', p_team_lead, 'note', v_note));
  perform private.notify(p_team_lead, 'HANDOVER_TO_TEAM_LEAD', format('New client for your team: %s', coalesce(v.company, v.name)),
    coalesce(v_note, 'The Department Head passed this client to you. Keep it or assign it to a team member.'), 'customer', p_customer);
end $$;
revoke all on function public.pass_to_team_lead(uuid, uuid, text) from public, anon;
grant execute on function public.pass_to_team_lead(uuid, uuid, text) to authenticated;

-- Support Team Lead -> member of the same Support team (or keep it).
create or replace function public.assign_to_team_member(p_customer uuid, p_member uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_lead_team uuid;
  v_name text;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or not (private.is_super_admin() or o.team_lead_id = (select private.my_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  if o.handover_stage not in ('TEAM_LEAD', 'TEAM_MEMBER') then
    raise exception 'CONFLICT: This customer has not been passed to a Team Lead yet.' using errcode = 'P0001';
  end if;
  select p.team_id into v_lead_team from public.profiles p
    join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
   where p.id = o.team_lead_id;
  if v_lead_team is null then
    raise exception 'CONFLICT: Only a Support Team Lead can assign this client.' using errcode = 'P0001';
  end if;
  if not (p_member = o.team_lead_id
          or exists (select 1 from public.profiles p where p.id = p_member and p.role = 'TEAM_MEMBER'
                      and p.status = 'ACTIVE' and p.team_id = v_lead_team)) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Member of your team.' using errcode = 'P0001';
  end if;
  if o.handover_stage = 'TEAM_MEMBER' and o.team_member_id = p_member then
    raise exception 'CONFLICT: The customer is already assigned to this person.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'TEAM_MEMBER', team_member_id = p_member, assigned_to_member_at = now(),
         assigned_to_member_by = (select private.my_id()), handover_note = coalesce(v_note, handover_note)
   where customer_id = p_customer;
  select full_name into v_name from public.profiles where id = p_member;
  perform private.log_customer_activity(p_customer, 'ASSIGNED_TO_TEAM_MEMBER',
    case when p_member = o.team_lead_id then format('Kept by Team Lead %s', v_name) else format('Assigned to %s', v_name) end
    || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_TEAM_MEMBER', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('team_member', p_member, 'kept_by_lead', p_member = o.team_lead_id, 'note', v_note));
  perform private.notify(p_member, 'HANDOVER_TO_TEAM_MEMBER', format('New client assigned to you: %s', coalesce(v.company, v.name)),
    coalesce(v_note, 'Your Team Lead assigned this client to you.'), 'customer', p_customer);
end $$;
revoke all on function public.assign_to_team_member(uuid, uuid, text) from public, anon;
grant execute on function public.assign_to_team_member(uuid, uuid, text) to authenticated;

