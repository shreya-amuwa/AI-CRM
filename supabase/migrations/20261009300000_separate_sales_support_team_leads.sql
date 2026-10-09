-- =============================================================================
-- Sales and Support Team Leads are separate.
--
-- Root cause of the mixing: every TEAM_HEAD resolved to one dashboard
-- ('team-lead') whatever their team's division, and the Support modules
-- (tickets, Support customers, invoice requests) accepted any staff member.
--
--  1. profiles.default_dashboard now resolves per department role:
--       TEAM_HEAD   + SALES   -> 'sales-lead'
--       TEAM_HEAD   + SUPPORT -> 'support-lead'
--       TEAM_MEMBER + SALES   -> 'sales-member'     (unchanged)
--       TEAM_MEMBER + SUPPORT -> 'support-member'   (unchanged; consultants stay 'technical-consultant')
--     It follows role / team changes (and a team's division change), so a user
--     moved from Sales to Support gets the Support dashboard and loses Sales.
--  2. Support records stay in Support, enforced in the database:
--       * a support ticket can only belong to a SUPPORT team and only Support
--         staff, a Department Head or the Super Admin can raise one;
--       * create_support_customer() only assigns to Support staff;
--       * invoice requests can only be raised by Support staff (or DH / SA);
--         the customer's owner still reads them (they raise the invoice);
--       * restrictive SELECT policies: Sales staff never read support tickets
--         or their history, whatever their generic role.
-- Additive / idempotent: no data is deleted. Run the whole file at once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stored default dashboard per department role
-- ---------------------------------------------------------------------------
create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case when v_slug = 'hr' then 'hr-head' else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;

-- A team whose division changes moves its people to the matching dashboard.
create or replace function private.tg_teams_division_dashboards()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.division is distinct from old.division then
    update public.profiles set updated_at = updated_at where team_id = new.id;
  end if;
  return new;
end $$;
revoke all on function private.tg_teams_division_dashboards() from public, anon, authenticated;
drop trigger if exists teams_division_dashboards on public.teams;
create trigger teams_division_dashboards after update of division on public.teams
  for each row execute function private.tg_teams_division_dashboards();

-- Existing Team Leads get 'sales-lead' / 'support-lead' (no other column changes).
update public.profiles set updated_at = updated_at where role = 'TEAM_HEAD';

-- ---------------------------------------------------------------------------
-- 2. Support records stay in Support
-- ---------------------------------------------------------------------------
-- Super Admin, a Department Head, or active Support staff (lead / member).
-- Calls without a signed-in user (migrations, service jobs) are not limited.
create or replace function private.may_work_in_support()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is null
      or private.is_super_admin()
      or private.my_role() = 'DEPARTMENT_HEAD'
      or private.is_support_staff()
$$;
revoke all on function private.may_work_in_support() from public, anon;
grant execute on function private.may_work_in_support() to authenticated;

-- Tickets: raised by Support staff, owned by a SUPPORT team.
create or replace function private.tg_support_tickets_support_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and not private.may_work_in_support() then
    raise exception 'FORBIDDEN: Only the Support team can raise support tickets.' using errcode = '42501';
  end if;
  if new.team_id is not null
     and not exists (select 1 from public.teams t where t.id = new.team_id and t.division = 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Support tickets can only be assigned to the Support team.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_support_tickets_support_only() from public, anon, authenticated;
drop trigger if exists support_tickets_support_only on public.support_tickets;
create trigger support_tickets_support_only before insert or update of team_id on public.support_tickets
  for each row execute function private.tg_support_tickets_support_only();

drop policy if exists support_tickets_support_only on public.support_tickets;
create policy support_tickets_support_only on public.support_tickets as restrictive for select to authenticated
  using ((select private.may_work_in_support()));
drop policy if exists support_ticket_updates_support_only on public.support_ticket_updates;
create policy support_ticket_updates_support_only on public.support_ticket_updates as restrictive for select to authenticated
  using ((select private.may_work_in_support()));

-- Invoice requests: Support only.
create or replace function private.tg_invoice_requests_support_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.may_work_in_support() then
    raise exception 'FORBIDDEN: Only the Support team can request invoices here.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_invoice_requests_support_only() from public, anon, authenticated;
drop trigger if exists invoice_requests_support_only on public.invoice_requests;
create trigger invoice_requests_support_only before insert on public.invoice_requests
  for each row execute function private.tg_invoice_requests_support_only();
-- Reading stays as it is: the customer's owner raises the invoice, so they keep
-- seeing the requests made for their customer (an intended cross-team feature).
-- Support customers: only Support staff (or DH / SA) add them, and only for Support staff.
create or replace function public.create_support_customer(
  p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_service_code text, p_service_details jsonb, p_requirement text, p_channel text, p_notes text,
  p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  owner public.profiles;
  v_service text := nullif(trim(coalesce(p_service_code, '')), '');
  v_id uuid;
  v_code text;
  v_name text := trim(coalesce(p_name, ''));
  v_lead uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into owner from public.profiles where id = coalesce(p_assignee, me.id) and status = 'ACTIVE';
  if owner.id is null or owner.team_id is null then
    raise exception 'VALIDATION_ERROR: Choose an active team member to assign this customer to.' using errcode = 'P0001';
  end if;
  if not private.may_work_in_support() then
    raise exception 'FORBIDDEN: Only the Support team can add customers here.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.id = owner.team_id and t.division = 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Assign the customer to a member of the Support team.' using errcode = 'P0001';
  end if;
  if not private.can_assign_customer_owner(owner.id) then
    raise exception 'FORBIDDEN: You cannot assign customers to this user.' using errcode = '42501';
  end if;
  perform private.check_support_customer_fields(p_name, p_email, p_phone, p_segment, p_status, v_service);
  perform private.raise_duplicate_customer(private.find_duplicate_customer(owner.department_id, p_email, p_phone, null));

  insert into public.customers (owner_id, name, company, phone, email, segment, status, notes,
                                service_code, service_interest, service_details, requirement, channel, lifecycle_stage)
  values (owner.id, v_name, nullif(trim(coalesce(p_company, '')), ''), nullif(trim(coalesce(p_phone, '')), ''),
          nullif(lower(trim(coalesce(p_email, ''))), ''),
          coalesce(p_segment, 'RETAIL')::public.customer_segment, coalesce(p_status, 'ACTIVE')::public.customer_status,
          nullif(trim(coalesce(p_notes, '')), ''), v_service,
          (select name from public.crm_services where code = v_service),
          private.normalize_service_details(v_service, p_service_details),
          nullif(trim(coalesce(p_requirement, '')), ''), nullif(trim(coalesce(p_channel, '')), ''), 'CUSTOMER')
  returning id, customer_code into v_id, v_code;

  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (v_id, me.id, 'CUSTOMER_CREATED', format('Added by %s%s', me.full_name,
          case when owner.id <> me.id then format(' and assigned to %s', owner.full_name) else '' end));

  if owner.id <> me.id then
    perform private.notify(owner.id, 'CUSTOMER_ASSIGNED', format('Customer assigned: %s', v_name),
      format('%s (%s) was assigned to you by %s.', v_name, v_code, me.full_name), 'customer', v_id);
  end if;
  for v_lead in select id from public.profiles
                 where role = 'TEAM_HEAD' and status = 'ACTIVE' and team_id = owner.team_id and id <> me.id loop
    perform private.notify(v_lead, 'CUSTOMER_ADDED', format('New customer: %s', v_name),
      format('%s (%s) was added for %s.', v_name, v_code, owner.full_name), 'customer', v_id);
  end loop;
  return v_id;
end $$;
revoke all on function public.create_support_customer(text, text, text, text, text, text, text, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_customer(text, text, text, text, text, text, text, jsonb, text, text, text, uuid) to authenticated;
