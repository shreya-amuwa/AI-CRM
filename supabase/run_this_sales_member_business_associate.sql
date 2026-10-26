-- =============================================================================
-- RUN THIS ONCE in the Supabase SQL editor (Run the whole file; safe to run again).
-- Run it after run_this_business_associate.sql.
-- A Sales Team Member (no Sales role) can work as a Business Associate from the Sales Team Member dashboard.
-- Nothing is removed; Business Associates keep their own dashboard and data.
-- =============================================================================

-- =============================================================================
-- Sales Team Members can act as Business Associates.
--
-- A Team Member of a Sales team who has no Sales role of their own (the "Sales Team Member" dashboard) gets the Business Associate
-- workspace inside that dashboard: contacts handed over by Telecallers, Leads, Quotation, Demo Schedule and Scope of Project.
-- Business Associates keep their own role, their own dashboard and everything they have; nothing is removed or renamed.
--
--  * private.ba_eligible(profile): an active Team Member who is a Business Associate, or a Sales Team Member with no Sales role.
--  * private.is_business_associate() uses it, so every Business Associate function (contacts, notes, quotations, demos, scope documents,
--    leads, home counts) works for such a Sales Team Member on THEIR OWN contacts only - the ownership checks are unchanged.
--  * ba_assignees / telecaller_lead_convert / ba_contact_reassign accept them as the person a contact is handed to. When a Telecaller does not
--    pick anyone, a dedicated Business Associate of the department is still preferred (then the one with the fewest open contacts).
-- Telecallers and the other Sales roles, Support and every other department are still refused. Additive / idempotent. Run the whole file at once.
-- =============================================================================

create or replace function private.ba_eligible(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p left join public.teams t on t.id = p.team_id
     where p.id = p_profile and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER'
       and (p.sales_sub_role = 'BUSINESS_ASSOCIATE' or (p.sales_sub_role is null and t.division = 'SALES')))
$$;
revoke all on function private.ba_eligible(uuid) from public, anon;
grant execute on function private.ba_eligible(uuid) to authenticated, service_role;

create or replace function private.is_business_associate()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.ba_eligible(private.my_id())
$$;

create or replace function public.ba_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid;
begin
  if not (private.is_telecaller() or private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD')) then
    raise exception 'FORBIDDEN: You cannot see the Business Associates.' using errcode = '42501';
  end if;
  v_dept := case when private.my_role() = 'SUPER_ADMIN' then null else private.my_department_id() end;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'departmentId', p.department_id,
      'openContacts', (select count(*) from public.ba_contacts c where c.assigned_to = p.id and c.stage <> 'COMPLETED')) order by p.full_name)
    from public.profiles p where private.ba_eligible(p.id) and (v_dept is null or p.department_id = v_dept)), '[]'::jsonb);
end $$;

-- A Telecaller converts a qualified lead (call status Interested) into a contact for a Business Associate of the department. One lead converts once.
-- Without a chosen Business Associate the one with the fewest open contacts gets it.
create or replace function public.telecaller_lead_convert(p_lead uuid, p_assignee uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  l public.customers;
  a public.profiles;
  c public.ba_contacts;
  v_existing uuid;
begin
  perform private.require_telecaller();
  select * into me from public.profiles where id = private.my_id();
  select * into l from public.customers where id = p_lead and owner_id = me.id and lifecycle_stage = 'LEAD' for update;
  if l.id is null then raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001'; end if;
  select id into v_existing from public.ba_contacts where lead_id = l.id;
  if v_existing is not null then raise exception 'CONFLICT: This lead has already been converted to a contact.' using errcode = 'P0001'; end if;
  if l.call_status is distinct from 'INTERESTED' then
    raise exception 'VALIDATION_ERROR: Only a qualified lead can be converted. Set its call status to Interested first.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'VALIDATION_ERROR: The hand-over note is too long (1,000 characters at most).' using errcode = 'P0001'; end if;
  if p_assignee is not null then
    select * into a from public.profiles where id = p_assignee;
    if a.id is null or not private.ba_eligible(a.id) or a.department_id is distinct from me.department_id then
      raise exception 'VALIDATION_ERROR: Choose an active Business Associate of your department.' using errcode = 'P0001';
    end if;
  else
    select p.* into a from public.profiles p
     where private.ba_eligible(p.id) and p.department_id = me.department_id
     order by (p.sales_sub_role is distinct from 'BUSINESS_ASSOCIATE'), (select count(*) from public.ba_contacts x where x.assigned_to = p.id and x.stage <> 'COMPLETED'), p.created_at
     limit 1;
    if a.id is null then raise exception 'VALIDATION_ERROR: Your department has no Business Associate yet. Ask your Department Head to add one.' using errcode = 'P0001'; end if;
  end if;
  begin
    insert into public.ba_contacts (lead_id, department_id, team_id, telecaller_id, assigned_to, assigned_by, handover_note)
    values (l.id, a.department_id, a.team_id, me.id, a.id, me.id, nullif(btrim(coalesce(p_note, '')), ''))
    returning * into c;
  exception when unique_violation then
    raise exception 'CONFLICT: This lead has already been converted to a contact.' using errcode = 'P0001';
  end;
  perform private.ba_event(c.id, 'ASSIGNED', format('Converted by %s and assigned to %s.%s', me.full_name, a.full_name, coalesce(' Note: ' || c.handover_note, '')));
  insert into public.customer_activities (customer_id, type, note) values (l.id, 'LEAD_UPDATED', format('Converted to a contact for %s', a.full_name));
  perform private.notify(a.id, 'BA_CONTACT_ASSIGNED', format('New contact: %s', l.name), format('%s handed over %s%s.', me.full_name, l.name, coalesce(' (' || l.company || ')', '')), 'ba_contact', c.id);
  perform private.write_audit('BA_CONTACT_CREATED', 'ba_contact', c.id, c.department_id, c.team_id, jsonb_build_object('lead', l.id, 'assignedTo', a.id, 'telecaller', me.id));
  return jsonb_build_object('contactId', c.id, 'assignedTo', a.id, 'assigneeName', a.full_name);
end $$;

-- Super Admin / Department Head: give a contact to another Business Associate of the department.
create or replace function public.ba_contact_reassign(p_contact uuid, p_assignee uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  a public.profiles;
  v_old text;
begin
  if private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can reassign a contact.' using errcode = '42501'; end if;
  select * into c from public.ba_contacts where id = p_contact for update;
  if c.id is null or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id is distinct from private.my_department_id()) then raise exception 'NOT_FOUND: Contact not found.' using errcode = 'P0001'; end if;
  select * into a from public.profiles where id = p_assignee;
  if a.id is null or not private.ba_eligible(a.id) or a.department_id is distinct from c.department_id then
    raise exception 'VALIDATION_ERROR: Choose an active Business Associate of the department.' using errcode = 'P0001';
  end if;
  select full_name into v_old from public.profiles where id = c.assigned_to;
  if a.id = c.assigned_to then return jsonb_build_object('contactId', c.id, 'assignedTo', a.id); end if;
  update public.ba_contacts set assigned_to = a.id, team_id = a.team_id, updated_at = now() where id = c.id;
  update public.ba_demos set assigned_to = a.id, updated_at = now() where contact_id = c.id and status in ('SCHEDULED', 'RESCHEDULED') and starts_at > now();
  perform private.ba_event(c.id, 'REASSIGNED', format('Reassigned from %s to %s.', coalesce(v_old, 'a former colleague'), a.full_name));
  perform private.notify(a.id, 'BA_CONTACT_ASSIGNED', 'A contact was assigned to you', 'Open Tasks to see it.', 'ba_contact', c.id);
  perform private.write_audit('BA_CONTACT_REASSIGNED', 'ba_contact', c.id, c.department_id, a.team_id, jsonb_build_object('from', c.assigned_to, 'to', a.id));
  return jsonb_build_object('contactId', c.id, 'assignedTo', a.id);
end $$;
