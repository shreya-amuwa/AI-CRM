-- =============================================================================
-- Meta Verifier: the first verification of a WhatsApp customer is no longer the Technical Consultant's job.
--
-- Until now one role (the Technical Consultant) both verified the customer's documents (the Meta / WhatsApp verification) and handled the
-- later consultation. They are now two roles:
--   * META VERIFIER   reviews the documents, records notes and outcomes, sends a customer back for correction, and when everything is
--                     verified hands the customer to the Department Head. A team member of a Support team, marked profiles.is_meta_verifier
--                     (the same convention as is_technical_consultant); a person is either a Meta Verifier or a Technical Consultant.
--   * TECHNICAL CONSULTANT  consults the customer some days after the hand-over (a persistent, configurable follow-up), records contact
--                     attempts and outcomes, discusses add-ons and refers them through the existing add-on workflow.
--
-- Which customers go to a Meta Verifier is DATA: crm_services.requires_meta_verification (seeded for WhatsApp API and WhatsApp API + Blue
-- Tick only; the Super Admin changes it). The route is decided when the customer is first sent for verification and then kept
-- (customer_onboarding.verification_route), so a catalogue change never moves work in flight. A customer that was already with a
-- Technical Consultant when this runs keeps that route; the Super Admin or the Department Head can re-route one (reroute_verification) and
-- verification_route_review lists the ones that may need it.
--
-- Not changed: the customer records, documents, notes, hand-over history and the Technical Consultant's route for every other service.
-- Safe to run again. Run after 20261205000100_operations_head.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The role
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_meta_verifier boolean not null default false;

create or replace function private.tg_profiles_meta_verifier_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_meta_verifier and (
       new.role <> 'TEAM_MEMBER'
       or not exists (select 1 from public.teams t where t.id = new.team_id and t.division = 'SUPPORT')) then
    new.is_meta_verifier := false;                    -- only a team member of a support team can be one (cleared if the role or team changes)
  end if;
  if new.is_meta_verifier and new.is_technical_consultant then
    raise exception 'VALIDATION_ERROR: A person is either a Meta Verifier or a Technical Consultant. Remove the other role first.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_meta_verifier_flag() from public, anon, authenticated;
drop trigger if exists profiles_meta_verifier_flag on public.profiles;
create trigger profiles_meta_verifier_flag before insert or update on public.profiles
  for each row execute function private.tg_profiles_meta_verifier_flag();

-- Switch an existing support team member to / from Meta Verifier.
create or replace function public.set_meta_verifier(p_user_id uuid, p_value boolean)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
begin
  select * into v_target from public.profiles where id = p_user_id for update;
  if v_target.id is null or not private.can_view_profile(v_target.id, v_target.role, v_target.department_id, v_target.team_id) then
    raise exception 'NOT_FOUND: User not found.' using errcode = 'P0001';
  end if;
  if not private.can_manage_profile(p_user_id)
     or not private.actor_can_assign_role(auth.uid(), 'TEAM_MEMBER', v_target.department_id, v_target.team_id) then
    raise exception 'FORBIDDEN: You cannot change this user.' using errcode = '42501';
  end if;
  if p_value and (v_target.role <> 'TEAM_MEMBER'
     or not exists (select 1 from public.teams t where t.id = v_target.team_id and t.division = 'SUPPORT')) then
    raise exception 'VALIDATION_ERROR: Only a team member of a support team can be a Meta Verifier.' using errcode = 'P0001';
  end if;
  if p_value and v_target.is_technical_consultant then
    raise exception 'VALIDATION_ERROR: This person is a Technical Consultant. Make them a team member first, then a Meta Verifier.' using errcode = 'P0001';
  end if;
  update public.profiles set is_meta_verifier = coalesce(p_value, false) where id = p_user_id returning * into v_target;
  perform private.write_audit('META_VERIFIER_SET', 'profile', p_user_id, v_target.department_id, v_target.team_id,
    jsonb_build_object('value', v_target.is_meta_verifier));
  return v_target;
end $$;
revoke all on function public.set_meta_verifier(uuid, boolean) from public, anon;
grant execute on function public.set_meta_verifier(uuid, boolean) to authenticated, service_role;

-- Staff created through the API (provisioned_meta_verifier = true) become Meta Verifiers when the account is provisioned.
CREATE OR REPLACE FUNCTION private.provision_auth_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user auth.users;
  v_meta jsonb;
  v_app jsonb;
  v_email text;
  v_name text;
  v_actor uuid;
  v_role public.app_role;
  v_department uuid;
  v_team uuid;
  v_head_division text;
  v_profile public.profiles;
  v_request public.approval_requests;
begin
  select * into v_user from auth.users where id = p_user_id;
  if v_user.id is null or exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
  v_app := coalesce(v_user.raw_app_meta_data, '{}'::jsonb);
  v_email := lower(v_user.email);
  v_name := left(coalesce(nullif(trim(v_meta ->> 'full_name'), ''), split_part(lower(v_user.email), '@', 1)), 160);

  if v_email is null then
    raise exception 'VALIDATION_ERROR: An e-mail address is required.' using errcode = 'P0001';
  end if;

  -- 1. Bootstrap the first Super Admin
  if coalesce((v_app ->> 'bootstrap_super_admin')::boolean, false) then
    if exists (select 1 from public.profiles where role = 'SUPER_ADMIN') then
      raise exception 'FORBIDDEN: A Super Admin already exists.' using errcode = '42501';
    end if;
    insert into public.profiles (id, email, full_name, role, status, approved_at)
    values (v_user.id, v_email, v_name, 'SUPER_ADMIN', 'ACTIVE', now()) returning * into v_profile;
    perform private.write_audit('USER_CREATED', 'profile', v_profile.id, null, null,
      jsonb_build_object('role', 'SUPER_ADMIN', 'bootstrap', true));
    return;
  end if;

  -- 2. Provisioned by a manager through the API
  if v_app ? 'provisioned_by' then
    v_actor := private.try_uuid(v_app ->> 'provisioned_by');
    begin
      v_role := (v_app ->> 'provisioned_role')::public.app_role;
    exception when others then
      raise exception 'VALIDATION_ERROR: Invalid role.' using errcode = 'P0001';
    end;
    v_team := private.try_uuid(v_app ->> 'provisioned_team_id');
    v_head_division := case when v_role = 'DEPARTMENT_HEAD' then nullif(v_app ->> 'provisioned_head_division', '') end;
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise exception 'FORBIDDEN: You are not allowed to create this user.' using errcode = '42501';
    end if;

    insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, head_division, approved_by, approved_at)
    values (v_user.id, v_email, v_name, nullif(trim(v_meta ->> 'position'), ''), v_role, 'ACTIVE',
            v_department, v_team, v_head_division, v_actor, now())
    returning * into v_profile;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
    values (v_actor, 'USER_CREATED', 'profile', v_profile.id, v_department, v_team,
            jsonb_build_object('role', v_role, 'email', v_email));
    if v_team is not null then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TEAM_MEMBER_ADDED', 'team', v_team, v_department, v_team, jsonb_build_object('user_id', v_profile.id));
    end if;

    if coalesce((v_app ->> 'provisioned_technical_consultant')::boolean, false) then
      update public.profiles set is_technical_consultant = true where id = v_profile.id returning * into v_profile;
      if not v_profile.is_technical_consultant then
        raise exception 'VALIDATION_ERROR: A Technical Consultant must be a team member of a support team.' using errcode = 'P0001';
      end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TECHNICAL_CONSULTANT_SET', 'profile', v_profile.id,
              v_profile.department_id, v_profile.team_id, jsonb_build_object('value', true));
    end if;
    if coalesce((v_app ->> 'provisioned_meta_verifier')::boolean, false) then
      update public.profiles set is_meta_verifier = true where id = v_profile.id returning * into v_profile;
      if not v_profile.is_meta_verifier then
        raise exception 'VALIDATION_ERROR: A Meta Verifier must be a team member of a support team.' using errcode = 'P0001';
      end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'META_VERIFIER_SET', 'profile', v_profile.id,
              v_profile.department_id, v_profile.team_id, jsonb_build_object('value', true));
    end if;
    return;
  end if;

  -- 3. Self-registration → PENDING team member awaiting approval
  select d.id into v_department from public.departments d
  where d.id = private.try_uuid(v_meta ->> 'department_id') and not d.is_locked;
  select t.id into v_team from public.teams t
  where t.id = private.try_uuid(v_meta ->> 'team_id') and t.department_id = v_department;

  insert into public.profiles (id, email, full_name, role, status, department_id, team_id)
  values (v_user.id, v_email, v_name, 'TEAM_MEMBER', 'PENDING', v_department, v_team)
  returning * into v_profile;

  insert into public.approval_requests (request_type, subject_user_id, department_id, team_id)
  values ('USER_REGISTRATION', v_profile.id, v_department, v_team)
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values (v_profile.id, 'USER_REGISTERED', 'profile', v_profile.id, v_department, v_team,
          jsonb_build_object('approval_request_id', v_request.id));

  perform private.route_registration_request(v_request, v_profile);
end $function$;

-- The dashboard the database proposes for the role
CREATE OR REPLACE FUNCTION private.tg_profiles_default_dashboard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_division text;
  v_slug text;
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  if new.sales_sub_role is not null and (new.role is distinct from 'TEAM_MEMBER' or v_division is distinct from 'SALES') then
    new.sales_sub_role := null;
  end if;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case
      when v_slug = 'hr' then 'hr-head'
      when new.head_division = 'SALES' and v_slug is distinct from 'accounts' then 'sales-department-head'
      else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' and coalesce(new.is_meta_verifier, false) then 'meta-verifier'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' and new.sales_sub_role = 'TELECALLER' then 'telecaller'
      when v_division = 'SALES' and new.sales_sub_role = 'BUSINESS_ASSOCIATE' then 'business-associate'
      when v_division = 'SALES' and new.sales_sub_role is not null then 'sales-' || lower(replace(new.sales_sub_role, '_', '-'))
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 2. Which services need a Meta Verifier, and which route a customer takes
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_services' and column_name = 'requires_meta_verification') then
    alter table public.crm_services add column requires_meta_verification boolean not null default false;
    -- seeded once: only the services named in the business process; the Super Admin changes it afterwards
    update public.crm_services set requires_meta_verification = true where code in ('WHATSAPP_API', 'WHATSAPP_API_BLUE_TICK');
  end if;
end $$;

alter table public.customer_onboarding add column if not exists verification_route text;
do $$
begin
  alter table public.customer_onboarding add constraint customer_onboarding_verification_route_check check (verification_route in ('META', 'TECHNICAL'));
exception when duplicate_object then null;
end $$;
-- Customers already with a Technical Consultant keep that route (their progress, notes and responsible people stay where they are).
update public.customer_onboarding set verification_route = 'TECHNICAL' where verification_route is null and forwarded_to_support_at is not null;

create or replace function private.computed_route(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                            where cs.customer_id = p_customer and s.requires_meta_verification) then 'META' else 'TECHNICAL' end
$$;
revoke all on function private.computed_route(uuid) from public, anon, authenticated;

-- META: a Meta Verifier verifies first. TECHNICAL: the Technical Consultant, as before.
create or replace function private.onboarding_route(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select o.verification_route from public.customer_onboarding o where o.customer_id = p_customer), private.computed_route(p_customer))
$$;
revoke all on function private.onboarding_route(uuid) from public, anon;
grant execute on function private.onboarding_route(uuid) to authenticated, service_role;

-- decided when the customer is first sent for verification, then kept
create or replace function private.tg_onboarding_pin_route()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.forwarded_to_support_at is not null and new.verification_route is null then
    new.verification_route := private.computed_route(new.customer_id);
  end if;
  return new;
end $$;
revoke all on function private.tg_onboarding_pin_route() from public, anon, authenticated;
drop trigger if exists customer_onboarding_pin_route on public.customer_onboarding;
create trigger customer_onboarding_pin_route before insert or update on public.customer_onboarding
  for each row execute function private.tg_onboarding_pin_route();

create or replace function public.set_service_meta_verification(p_code text, p_value boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can change this.' using errcode = '42501';
  end if;
  if p_value is null then
    raise exception 'VALIDATION_ERROR: Choose yes or no.' using errcode = 'P0001';
  end if;
  update public.crm_services set requires_meta_verification = p_value where code = p_code;
  if not found then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit('SERVICE_META_VERIFICATION_SET', 'service', null, null, null, jsonb_build_object('code', p_code, 'value', p_value));
end $$;
revoke all on function public.set_service_meta_verification(text, boolean) from public, anon;
grant execute on function public.set_service_meta_verification(text, boolean) to authenticated;

-- the catalogue read shows it
create or replace function public.service_journeys()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when (select private.my_id()) is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'category', s.category, 'isActive', s.is_active,
             'requiresTechnicalConsultant', s.requires_technical_consultant, 'requiresMetaVerification', s.requires_meta_verification,
             'deliveryDepartmentId', s.delivery_department_id, 'deliveryDepartment', d.name) order by s.sort_order, s.code)
      from public.crm_services s left join public.departments d on d.id = s.delivery_department_id), '[]'::jsonb) end
$$;

-- ---------------------------------------------------------------------------
-- 3. Who may do what
-- ---------------------------------------------------------------------------
-- the department of a Meta Verifier (and of a support Team Lead, who supervises both)
create or replace function private.my_verifier_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p join public.teams t on t.id = p.team_id
  where p.id = auth.uid() and p.status = 'ACTIVE' and t.division = 'SUPPORT'
    and (p.is_meta_verifier or p.role = 'TEAM_HEAD')
$$;
revoke all on function private.my_verifier_department_id() from public, anon;
grant execute on function private.my_verifier_department_id() to authenticated, service_role;

-- The Technical Consultant sees a customer that goes through a Meta Verifier only once the verification is finished and handed over.
create or replace function private.consult_visible(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.onboarding_route(p_customer) <> 'META'
      or exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer and o.handover_stage <> 'CONSULTANT')
$$;
revoke all on function private.consult_visible(uuid) from public, anon;
grant execute on function private.consult_visible(uuid) to authenticated, service_role;

-- Consultation (add-ons, "contacted", the customer's details): the Technical Consultant after the hand-over of a META customer; in the
-- consultant's own stage for the other route (as it always was); the Department Head and the Super Admin as before.
create or replace function private.can_consult_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c join public.customer_onboarding o on o.customer_id = c.id
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.forwarded_to_support_at is not null
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (c.department_id = private.my_support_department_id()
            and ((private.onboarding_route(c.id) <> 'META' and o.handover_stage = 'CONSULTANT')
                 or (private.onboarding_route(c.id) = 'META' and o.handover_stage <> 'CONSULTANT')))))
$$;
revoke all on function private.can_consult_customer(uuid) from public, anon;
grant execute on function private.can_consult_customer(uuid) to authenticated, service_role;

-- Verification: the Meta Verifier for a META customer, the Technical Consultant for the other route; both only in the verification stage.
create or replace function private.can_review_onboarding(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and private.onboarding_forwarded(c.id)
      -- once handed over to the Department Head the verification is closed
      and not exists (select 1 from public.customer_onboarding o where o.customer_id = c.id and o.handover_stage <> 'CONSULTANT')
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (private.onboarding_route(c.id) = 'META' and c.department_id = private.my_verifier_department_id())
        or (private.onboarding_route(c.id) <> 'META' and c.department_id = private.my_support_department_id())))
$$;
grant execute on function private.can_review_onboarding(uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.can_view_onboarding_review(p_customer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.customers c
    join public.customer_onboarding o on o.customer_id = c.id
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and o.with_consultant
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (private.onboarding_route(c.id) = 'META' and c.department_id = private.my_verifier_department_id())
        or (c.department_id = private.my_support_department_id() and private.consult_visible(c.id))
        or private.handover_recipient(c.id)))
  or private.delivery_recipient(p_customer)
$function$;

-- the customers a Meta Verifier or a Technical Consultant may read (the other tables follow what they can read of the customer)
drop policy if exists customers_select_review on public.customers;
create policy customers_select_review on public.customers for select to authenticated using (
  lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and private.onboarding_with_consultant(id)
  and ((department_id = (select private.my_verifier_department_id()) and private.onboarding_route(id) = 'META')
    or (department_id = (select private.my_support_department_id()) and private.consult_visible(id))));

CREATE OR REPLACE FUNCTION private.can_correct_onboarding_item(p_customer uuid, p_item text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_item <> 'INVOICE'
     and private.can_review_onboarding(p_customer)
     and exists (select 1 from public.customers c where c.id = p_customer and c.lifecycle_stage = 'ONBOARDING'
                  and c.department_id = case when private.onboarding_route(c.id) = 'META' then private.my_verifier_department_id() else private.my_support_department_id() end)
     and (exists (select 1 from private.customer_items(p_customer) i where i.code = p_item)
          or exists (select 1 from private.customer_optional_items(p_customer) i where i.code = p_item))
$function$;
CREATE OR REPLACE FUNCTION private.can_manage_addons(p_customer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_support_department_id())
          and private.can_consult_customer(p_customer))
      or (exists (select 1 from public.customers c
                   where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
                     and (c.department_id = private.my_support_department_id()
                          or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
                          or private.my_role() = 'SUPER_ADMIN'))
          and exists (select 1 from public.service_requests r where r.customer_id = p_customer and r.status in ('REQUESTED', 'IN_REVIEW', 'IN_ADDON_WORKFLOW')))
$function$;
CREATE OR REPLACE FUNCTION public.consultant_set_contract(p_customer uuid, p_signed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_consult_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set contract_signed = coalesce(p_signed, false) where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'CONTRACT_UPDATED',
    case when coalesce(p_signed, false) then 'Contract marked as received' else 'Contract marked as not received' end);
end $function$;
CREATE OR REPLACE FUNCTION public.consultant_update_customer(p_customer uuid, p_name text, p_company text, p_phone text, p_email text, p_expected text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_updated timestamptz;
begin
  if not private.can_consult_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 then
    raise exception 'VALIDATION_ERROR: Enter the customer''s name.' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'VALIDATION_ERROR: Enter a phone number or an e-mail address.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if v_phone is not null and (v_phone !~ '^[0-9+()\-\s.]{5,25}$' or length(regexp_replace(v_phone, '\D', '', 'g')) < 7) then
    raise exception 'VALIDATION_ERROR: Enter a valid phone number (at least 7 digits).' using errcode = 'P0001';
  end if;
  select updated_at into v_updated from public.customers where id = p_customer for update;
  if p_expected is not null and v_updated is distinct from p_expected::timestamptz then
    raise exception 'CONFLICT: This customer was changed by someone else while you were editing. Close this and open it again to see the latest details.' using errcode = 'P0001';
  end if;
  begin
    update public.customers
       set name = v_name, company = nullif(trim(coalesce(p_company, '')), ''), phone = v_phone, email = v_email,
           updated_by = (select private.my_id())
     where id = p_customer;
  exception when unique_violation then
    raise exception 'CONFLICT: Another customer of this department already uses that e-mail address.' using errcode = 'P0001';
  end;
  perform private.log_customer_activity(p_customer, 'CUSTOMER_UPDATED', 'Details updated by the Technical Consultant');
end $function$;
CREATE OR REPLACE FUNCTION public.consultant_set_addons_required(p_customer uuid, p_required boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_consult_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_required is null then
    raise exception 'VALIDATION_ERROR: Choose Yes or No.' using errcode = 'P0001';
  end if;
  if not p_required and exists (select 1 from public.addon_requests where customer_id = p_customer
                                   and status not in ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED', 'COMPLETED')) then
    raise exception 'CONFLICT: An add-on request is with Accounts or already paid, so the answer cannot change to No.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set addons_required = p_required where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ADDONS_REQUIRED_UPDATED',
    case when p_required then 'Customer needs add-on services' else 'Customer does not need add-on services' end);
end $function$;
CREATE OR REPLACE FUNCTION private.forward_to_consultant(p_id uuid, v customers, v_again boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_recipient uuid;
  v_meta boolean := private.onboarding_route(p_id) = 'META';
begin
  if v_meta and not exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                             where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id and p.is_meta_verifier) then
    raise exception 'CONFLICT: This department has no active Meta Verifier to verify the customer. Ask the Super Admin or the Department Head to assign one.' using errcode = 'P0001';
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
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
    where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
      and ((case when v_meta then p.is_meta_verifier else p.is_technical_consultant end) or p.role = 'TEAM_HEAD')
  loop
    perform private.notify(v_recipient, 'ONBOARDING_FORWARDED',
      format(case when v_again then 'Re-verify: %s' else 'New customer to verify: %s' end, coalesce(v.company, v.name)),
      case when v_again then 'Sales fixed the items you sent back.' else 'Accounts confirmed the amount. The customer''s details and documents are ready for verification.' end,
      'customer', p_id);
  end loop;
end $function$;
CREATE OR REPLACE FUNCTION public.send_to_department_head(p_customer uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  for v_head in
    select id from public.profiles where role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' and department_id = v.department_id
  loop
    v_count := v_count + 1;
  end loop;
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
  -- the Technical Consultant's consultation follows some days later (a persistent follow-up; the delay is a setting)
  if v_meta then
    perform private.schedule_tc_followup(p_customer, 'The Meta Verifier verified the customer and handed it over. Contact the customer for the consultation and any add-on services.');
  end if;

  for v_head in
    select id from public.profiles where role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' and department_id = v.department_id
  loop
    perform private.notify(v_head, 'HANDOVER_TO_DEPARTMENT_HEAD', format('New client to assign: %s', coalesce(v.company, v.name)),
      coalesce(v_note, case when v_meta then 'The Meta Verifier verified everything.' else 'The Technical Consultant verified everything.' end), 'customer', p_customer);
  end loop;
  perform private.notify(v.owner_id, 'HANDOVER_TO_DEPARTMENT_HEAD', format('Verified: %s', coalesce(v.company, v.name)),
    case when v_meta then 'The Meta Verifier verified the customer and sent it to the Department Head.' else 'The Technical Consultant verified the customer and sent it to the Department Head.' end, 'customer', p_customer);
end $function$;

-- ---------------------------------------------------------------------------
-- 4. Verification notes and outcomes (the history of the verification, kept with the customer)
-- ---------------------------------------------------------------------------
create table if not exists public.verification_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  outcome text not null default 'NOTE' check (outcome in ('NOTE', 'PENDING', 'NEEDS_CORRECTION', 'VERIFIED')),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists verification_notes_customer_idx on public.verification_notes (customer_id, created_at desc);
alter table public.verification_notes enable row level security;
revoke all on public.verification_notes from public, anon, authenticated;

create or replace function public.verification_notes_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_onboarding_review(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'outcome', n.outcome, 'body', n.body, 'createdAt', n.created_at,
                                                       'author', (select p.full_name from public.profiles p where p.id = n.author_id)) order by n.created_at desc)
                     from public.verification_notes n where n.customer_id = p_customer), '[]'::jsonb);
end $$;
revoke all on function public.verification_notes_list(uuid) from public, anon;
grant execute on function public.verification_notes_list(uuid) to authenticated;

create or replace function public.verification_note_add(p_customer uuid, p_body text, p_outcome text default 'NOTE')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  n public.verification_notes;
  v_body text := btrim(coalesce(p_body, ''));
  v_outcome text := upper(coalesce(nullif(btrim(p_outcome), ''), 'NOTE'));
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if length(v_body) < 1 or length(v_body) > 2000 then
    raise exception 'VALIDATION_ERROR: Write the note (up to 2000 characters).' using errcode = 'P0001';
  end if;
  if v_outcome not in ('NOTE', 'PENDING', 'NEEDS_CORRECTION', 'VERIFIED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  insert into public.verification_notes (customer_id, author_id, outcome, body) values (p_customer, (select private.my_id()), v_outcome, v_body) returning * into n;
  perform private.log_customer_activity(p_customer, 'VERIFICATION_NOTE', case v_outcome when 'NOTE' then 'Verification note added' else 'Verification: ' || lower(replace(v_outcome, '_', ' ')) end);
  perform private.write_audit('VERIFICATION_NOTE_ADDED', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('outcome', v_outcome));
  return jsonb_build_object('id', n.id, 'outcome', n.outcome, 'body', n.body, 'createdAt', n.created_at);
end $$;
revoke all on function public.verification_note_add(uuid, text, text) from public, anon;
grant execute on function public.verification_note_add(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Re-routing a customer already in verification (Super Admin or the Department Head of the department)
-- ---------------------------------------------------------------------------
create or replace function public.reroute_verification(p_customer uuid, p_route text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_route text := upper(coalesce(p_route, ''));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  r uuid;
begin
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not (private.is_super_admin() or (private.my_role() = 'DEPARTMENT_HEAD' and v.department_id = private.my_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_route not in ('META', 'TECHNICAL') then
    raise exception 'VALIDATION_ERROR: Choose the Meta Verifier or the Technical Consultant.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Give the reason.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or o.forwarded_to_support_at is null or o.handover_stage <> 'CONSULTANT' then
    raise exception 'CONFLICT: The customer is not in verification, so it cannot be re-routed.' using errcode = 'P0001';
  end if;
  if coalesce(o.verification_route, private.computed_route(p_customer)) = v_route then
    return;
  end if;
  if v_route = 'META' and not exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                                       where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id and p.is_meta_verifier) then
    raise exception 'CONFLICT: This department has no active Meta Verifier.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set verification_route = v_route where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'VERIFICATION_REROUTED', 'Verification moved to the ' || case when v_route = 'META' then 'Meta Verifier' else 'Technical Consultant' end || ' · ' || v_reason);
  perform private.write_audit('VERIFICATION_REROUTED', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('route', v_route, 'reason', v_reason));
  for r in select p.id from public.profiles p join public.teams t on t.id = p.team_id
            where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
              and ((case when v_route = 'META' then p.is_meta_verifier else p.is_technical_consultant end) or p.role = 'TEAM_HEAD') loop
    perform private.notify(r, 'ONBOARDING_FORWARDED', format('Customer to verify: %s', coalesce(v.company, v.name)), v_reason, 'customer', p_customer);
  end loop;
end $$;
revoke all on function public.reroute_verification(uuid, text, text) from public, anon;
grant execute on function public.reroute_verification(uuid, text, text) to authenticated;

-- Customers already in verification whose services say another route than the one they have (decided before this change).
create or replace function public.verification_route_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or private.my_role() = 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only the Super Admin or a Department Head can see this.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('customerId', c.id, 'name', coalesce(c.company, c.name), 'department', d.name, 'route', o.verification_route,
                                        'suggestedRoute', private.computed_route(c.id), 'reviewState', o.review_state) order by c.created_at)
      from public.customers c join public.customer_onboarding o on o.customer_id = c.id join public.departments d on d.id = c.department_id
     where o.forwarded_to_support_at is not null and o.handover_stage = 'CONSULTANT' and c.lifecycle_stage = 'ONBOARDING'
       and o.verification_route is distinct from private.computed_route(c.id)
       and (private.is_super_admin() or c.department_id = private.my_department_id())), '[]'::jsonb);
end $$;
revoke all on function public.verification_route_review() from public, anon;
grant execute on function public.verification_route_review() to authenticated;

-- a failed onboarding message is the verifier's to fix for a META customer (the consultant's for the other route)
CREATE OR REPLACE FUNCTION public.automation_finish_job(p_job uuid, p_outcome text, p_detail text DEFAULT NULL::text, p_response_code integer DEFAULT NULL::integer, p_recipient text DEFAULT NULL::text, p_provider_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  j public.automation_jobs;
  v public.customers;
  v_status text;
  v_recipient uuid;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into j from public.automation_jobs where id = p_job for update;
  if j.id is null or j.status <> 'SENDING' then
    raise exception 'CONFLICT: This job is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and j.attempts >= 5 then 'FAILED'
                   when p_outcome = 'RETRY' then 'QUEUED' else p_outcome end;
  update public.automation_jobs
     set status = v_status,
         detail = left(p_detail, 500),
         response_code = p_response_code,
         recipient = coalesce(left(p_recipient, 254), recipient),
         provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         locked_until = null,
         next_attempt_at = case when v_status = 'QUEUED'
                                then now() + (array[1, 5, 15, 60])[least(j.attempts, 4)] * interval '1 minute'
                                else next_attempt_at end,
         sent_at = case when v_status = 'SENT' then now() else sent_at end,
         secret = case when v_status = 'QUEUED' then secret end
   where id = p_job
  returning * into j;

  if v_status in ('SENT', 'FAILED', 'SKIPPED') then
    select * into v from public.customers where id = j.customer_id;
    if not j.internal then
      perform private.log_customer_activity(j.customer_id, 'AUTOMATION_' || j.channel || '_' || v_status,
        format('%s %s: %s%s', initcap(replace(j.stage, '_', ' ')), case when j.channel = 'EMAIL' then 'email' else 'WhatsApp' end,
               lower(v_status), case when p_detail is not null and v_status <> 'SENT' then ' - ' || left(p_detail, 200) else '' end));
    end if;
    if v_status = 'FAILED' then
      perform private.write_audit('AUTOMATION_FAILED', 'customer', j.customer_id, v.department_id, v.team_id,
        jsonb_build_object('job', j.id, 'channel', j.channel, 'stage', j.stage, 'detail', left(p_detail, 200)));
      if j.internal then
        for v_recipient in
          select p.id from public.profiles p join public.departments d on d.id = p.department_id
           where p.status = 'ACTIVE' and d.slug = 'accounts'
        loop
          perform private.notify(v_recipient, 'AUTOMATION_FAILED', format('Payment email not sent: %s', coalesce(v.company, v.name)),
            format('The email about this payment request could not be sent after %s attempts: %s. The request is still in your queue.', j.attempts, coalesce(left(p_detail, 300), 'unknown error')),
            'customer', j.customer_id, '{}'::jsonb, 'urgent');
        end loop;
      else
        for v_recipient in
          select p.id from public.profiles p join public.teams t on t.id = p.team_id
           where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
             and ((case when private.onboarding_route(v.id) = 'META' then p.is_meta_verifier else p.is_technical_consultant end) or p.role = 'TEAM_HEAD')
        loop
          perform private.notify(v_recipient, 'AUTOMATION_FAILED',
            format('%s not sent: %s', case when j.channel = 'EMAIL' then 'Email' else 'WhatsApp' end, coalesce(v.company, v.name)),
            format('The %s message could not be sent after %s attempts: %s', initcap(replace(j.stage, '_', ' ')), j.attempts, coalesce(left(p_detail, 300), 'unknown error')),
            'customer', j.customer_id, '{}'::jsonb, 'urgent');
        end loop;
      end if;
    end if;
  end if;
  return jsonb_build_object('id', j.id, 'status', j.status, 'attempts', j.attempts, 'nextAttemptAt', j.next_attempt_at);
end $function$;

-- ---------------------------------------------------------------------------
-- 6. The Technical Consultant's follow-up: persistent, configurable, revalidated
-- ---------------------------------------------------------------------------
-- The business has not said how many days the consultant waits after the hand-over, so there is NO default: the Super Admin sets it
-- (set_tc_followup_delay). Until it is set a follow-up waits as AWAITING_CONFIGURATION and is scheduled the moment the delay is set.
create table if not exists public.workflow_settings (
  id boolean primary key default true check (id),
  tc_followup_delay_days integer check (tc_followup_delay_days is null or tc_followup_delay_days between 1 and 365),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.workflow_settings (id) values (true) on conflict (id) do nothing;
alter table public.workflow_settings enable row level security;
revoke all on public.workflow_settings from public, anon, authenticated;

create table if not exists public.tc_followups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  department_id uuid not null references public.departments (id),
  assigned_to uuid references public.profiles (id) on delete set null,
  status text not null check (status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE', 'DONE', 'CANCELLED')),
  reason text,
  eligible_at timestamptz not null default now(),
  due_at timestamptz,
  due_notified_at timestamptz,
  last_outcome text,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'SCHEDULED') = (due_at is not null) or status in ('DUE', 'DONE', 'CANCELLED'))
);
-- one open follow-up per customer: a repeated hand-over or event cannot create a second one
create unique index if not exists tc_followups_one_open on public.tc_followups (customer_id) where status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE');
create index if not exists tc_followups_due_idx on public.tc_followups (due_at) where status = 'SCHEDULED';
create index if not exists tc_followups_dept_idx on public.tc_followups (department_id, status);
alter table public.tc_followups enable row level security;
revoke all on public.tc_followups from public, anon, authenticated;
-- read-only for the people whose scope it is (for Realtime: the list follows a follow-up falling due or being cancelled); every change goes through the functions
grant select on public.tc_followups to authenticated;

create table if not exists public.tc_followup_contacts (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null references public.tc_followups (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  channel text not null check (channel in ('CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'OTHER')),
  outcome text not null check (outcome in ('NO_ANSWER', 'CALL_BACK', 'CONTACTED', 'ADDON_INTERESTED', 'NOT_INTERESTED', 'COMPLETED')),
  note text check (length(note) <= 2000),
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tc_followup_contacts_idx on public.tc_followup_contacts (followup_id, created_at desc);
alter table public.tc_followup_contacts enable row level security;
revoke all on public.tc_followup_contacts from public, anon, authenticated;

-- the Technical Consultant of the department with the fewest open follow-ups
create or replace function private.pick_consultant(p_department uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = p_department and p.is_technical_consultant
   order by (select count(*) from public.tc_followups f where f.assigned_to = p.id and f.status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE')), p.created_at
   limit 1
$$;
revoke all on function private.pick_consultant(uuid) from public, anon, authenticated;

-- Called when a META customer is handed to the Department Head. Idempotent.
create or replace function private.schedule_tc_followup(p_customer uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_days integer;
  v_id uuid;
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
  returning id into v_id;
  if v_id is null then
    return;                                                     -- already scheduled: nothing is created or notified twice
  end if;
  perform private.log_customer_activity(p_customer, 'TC_FOLLOWUP_SCHEDULED',
    case when v_days is null then 'Technical Consultant follow-up waits for the delay to be set' else format('Technical Consultant follow-up scheduled in %s day(s)', v_days) end);
  perform private.write_audit('TC_FOLLOWUP_SCHEDULED', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('followup_id', v_id, 'delay_days', v_days));
end $$;
revoke all on function private.schedule_tc_followup(uuid, text) from public, anon, authenticated;

-- the delay (Super Admin)
create or replace function public.workflow_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or private.my_role() = 'DEPARTMENT_HEAD' or private.my_support_department_id() is not null) then
    raise exception 'FORBIDDEN: You cannot see this.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('tcFollowupDelayDays', w.tc_followup_delay_days, 'updatedAt', w.updated_at, 'canEdit', private.is_super_admin(),
            'awaiting', (select count(*) from public.tc_followups f where f.status = 'AWAITING_CONFIGURATION'
                                                                       and (private.is_super_admin() or f.department_id = private.my_department_id())))
            from public.workflow_settings w where w.id);
end $$;
revoke all on function public.workflow_settings_get() from public, anon;
grant execute on function public.workflow_settings_get() to authenticated;

create or replace function public.set_tc_followup_delay(p_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_scheduled integer := 0;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can set the follow-up delay.' using errcode = '42501';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then
    raise exception 'VALIDATION_ERROR: Enter a number of days from 1 to 365.' using errcode = 'P0001';
  end if;
  update public.workflow_settings set tc_followup_delay_days = p_days, updated_by = auth.uid(), updated_at = now() where id;
  -- follow-ups that were waiting for the setting are scheduled now, counted from the hand-over; ones already scheduled keep their date
  if p_days is not null then
    update public.tc_followups set status = 'SCHEDULED', due_at = eligible_at + make_interval(days => p_days), updated_at = now() where status = 'AWAITING_CONFIGURATION';
    get diagnostics v_scheduled = row_count;
  end if;
  perform private.write_audit('TC_FOLLOWUP_DELAY_SET', 'workflow_settings', null, null, null, jsonb_build_object('days', p_days, 'scheduled_now', v_scheduled));
  return public.workflow_settings_get();
end $$;
revoke all on function public.set_tc_followup_delay(integer) from public, anon;
grant execute on function public.set_tc_followup_delay(integer) to authenticated;

-- A follow-up that no longer applies is cancelled, never executed: the customer left onboarding / returned to leads / moved department.
create or replace function private.tg_customer_cancel_followups()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') or new.department_id is distinct from old.department_id then
    update public.tc_followups
       set status = 'CANCELLED', cancelled_at = now(), cancelled_reason = case when new.department_id is distinct from old.department_id then 'The customer moved to another department.' else 'The customer is no longer in onboarding.' end, updated_at = now()
     where customer_id = new.id and status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE');
  end if;
  return new;
end $$;
revoke all on function private.tg_customer_cancel_followups() from public, anon, authenticated;
drop trigger if exists customers_cancel_followups on public.customers;
create trigger customers_cancel_followups after update of lifecycle_stage, department_id on public.customers
  for each row when (old.lifecycle_stage is distinct from new.lifecycle_stage or old.department_id is distinct from new.department_id)
  execute function private.tg_customer_cancel_followups();

-- Who may work on follow-ups of this department: the consultant (their own and unassigned ones), the support Team Lead, the Department Head, the Super Admin.
create or replace function private.followup_scope(p_followup public.tc_followups)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin()
      or (private.my_role() = 'DEPARTMENT_HEAD' and p_followup.department_id = private.my_department_id())
      or (p_followup.department_id = private.my_support_department_id()
          and (private.my_role() = 'TEAM_HEAD' or p_followup.assigned_to is null or p_followup.assigned_to = (select private.my_id())))
$$;
revoke all on function private.followup_scope(public.tc_followups) from public, anon, authenticated;
grant execute on function private.followup_scope(public.tc_followups) to authenticated;
drop policy if exists tc_followups_select on public.tc_followups;
create policy tc_followups_select on public.tc_followups for select to authenticated using (private.followup_scope(tc_followups));
do $$
begin
  begin
    alter publication supabase_realtime add table public.tc_followups;
  exception when duplicate_object or undefined_object then null;
  end;
end $$;

create or replace function public.tc_followups_list(p_scope text default 'OPEN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope text := upper(coalesce(p_scope, 'OPEN'));
begin
  if not (private.is_super_admin() or private.my_role() = 'DEPARTMENT_HEAD' or private.my_support_department_id() is not null) then
    raise exception 'FORBIDDEN: Only Technical Consultants and their managers can see follow-ups.' using errcode = '42501';
  end if;
  if v_scope not in ('OPEN', 'DONE', 'ALL') then
    raise exception 'VALIDATION_ERROR: Unknown filter.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.sort_key) from (
      select jsonb_build_object(
               'id', f.id, 'customerId', f.customer_id, 'customer', coalesce(c.company, c.name), 'contact', c.name, 'phone', c.phone,
               'whatsapp', coalesce(nullif(btrim(c.whatsapp), ''), c.phone), 'email', c.email,
               'services', (select coalesce(jsonb_agg(s.name order by s.sort_order), '[]'::jsonb) from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = f.customer_id),
               'status', f.status,
               'effectiveStatus', case when f.status = 'SCHEDULED' and f.due_at <= now() then 'DUE' else f.status end,
               'dueAt', f.due_at, 'eligibleAt', f.eligible_at, 'reason', f.reason, 'lastOutcome', f.last_outcome,
               'assignedTo', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = f.assigned_to),
               'handedOverBy', (select p.full_name from public.customer_onboarding o join public.profiles p on p.id = o.to_department_head_by where o.customer_id = f.customer_id),
               'handoverNote', (select o.handover_note from public.customer_onboarding o where o.customer_id = f.customer_id),
               'contacts', (select count(*) from public.tc_followup_contacts k where k.followup_id = f.id),
               'lastContact', (select jsonb_build_object('at', k.created_at, 'outcome', k.outcome, 'channel', k.channel, 'note', k.note)
                                 from public.tc_followup_contacts k where k.followup_id = f.id order by k.created_at desc limit 1),
               'cancelledReason', f.cancelled_reason) as j,
             coalesce(f.due_at, f.eligible_at + interval '100 years') as sort_key
        from public.tc_followups f join public.customers c on c.id = f.customer_id
       where private.followup_scope(f)
         and (v_scope = 'ALL' or (v_scope = 'OPEN' and f.status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE')) or (v_scope = 'DONE' and f.status in ('DONE', 'CANCELLED')))
       limit 300) x), '[]'::jsonb);
end $$;
revoke all on function public.tc_followups_list(text) from public, anon;
grant execute on function public.tc_followups_list(text) to authenticated;

create or replace function public.tc_followup_record(p_followup uuid, p_channel text, p_outcome text, p_note text, p_next timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.tc_followups;
  v public.customers;
  v_channel text := upper(coalesce(p_channel, ''));
  v_outcome text := upper(coalesce(p_outcome, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_status text;
begin
  select * into f from public.tc_followups where id = p_followup for update;
  if f.id is null or not private.followup_scope(f) then
    raise exception 'NOT_FOUND: Follow-up not found.' using errcode = 'P0001';
  end if;
  if f.status not in ('SCHEDULED', 'DUE') then
    raise exception 'CONFLICT: %', case f.status when 'AWAITING_CONFIGURATION' then 'This follow-up is waiting for the Super Admin to set the delay.' when 'DONE' then 'This follow-up is already finished.' else 'This follow-up was cancelled.' end using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = f.customer_id;
  -- revalidate the persisted state: the customer must still be in onboarding, in the same department
  if v.id is null or v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') or v.department_id is distinct from f.department_id then
    update public.tc_followups set status = 'CANCELLED', cancelled_at = now(), cancelled_reason = 'The customer is no longer eligible.', updated_at = now() where id = f.id;
    raise exception 'CONFLICT: This customer is no longer eligible for the follow-up.' using errcode = 'P0001';
  end if;
  if v_channel not in ('CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose how you contacted the customer.' using errcode = 'P0001';
  end if;
  if v_outcome not in ('NO_ANSWER', 'CALL_BACK', 'CONTACTED', 'ADDON_INTERESTED', 'NOT_INTERESTED', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR: Choose the outcome.' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 2000 characters.' using errcode = 'P0001';
  end if;
  if p_next is not null and p_next <= now() then
    raise exception 'VALIDATION_ERROR: The next follow-up must be in the future.' using errcode = 'P0001';
  end if;
  if v_outcome in ('NO_ANSWER', 'CALL_BACK') and p_next is null then
    raise exception 'VALIDATION_ERROR: Give the date of the next follow-up.' using errcode = 'P0001';
  end if;

  insert into public.tc_followup_contacts (followup_id, customer_id, author_id, channel, outcome, note, next_follow_up_at)
  values (f.id, f.customer_id, (select private.my_id()), v_channel, v_outcome, v_note, p_next);
  -- the conversation also joins the customer's consultation notes (one history)
  if v_note is not null and private.can_write_consultant_notes(f.customer_id) then
    insert into public.consultant_notes (customer_id, author_id, body) values (f.customer_id, (select private.my_id()), left('Follow-up (' || lower(v_channel) || ', ' || lower(replace(v_outcome, '_', ' ')) || '): ' || v_note, 4000));
  end if;

  v_status := case when v_outcome in ('COMPLETED', 'NOT_INTERESTED') then 'DONE' when p_next is not null then 'SCHEDULED' else 'DUE' end;
  update public.tc_followups
     set status = v_status, last_outcome = v_outcome, updated_at = now(),
         assigned_to = coalesce(assigned_to, (select private.my_id())),
         due_at = case when v_status = 'SCHEDULED' then p_next else due_at end,
         due_notified_at = case when v_status = 'SCHEDULED' then null else due_notified_at end,
         completed_at = case when v_status = 'DONE' then now() end, completed_by = case when v_status = 'DONE' then (select private.my_id()) end
   where id = f.id;
  perform private.log_customer_activity(f.customer_id, 'TC_FOLLOWUP_CONTACT', format('Consultation follow-up: %s (%s)', lower(replace(v_outcome, '_', ' ')), lower(v_channel)));
  perform private.write_audit('TC_FOLLOWUP_CONTACT', 'customer', f.customer_id, v.department_id, v.team_id, jsonb_build_object('followup_id', f.id, 'outcome', v_outcome, 'channel', v_channel));
  return jsonb_build_object('id', f.id, 'status', v_status);
end $$;
revoke all on function public.tc_followup_record(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.tc_followup_record(uuid, text, text, text, timestamptz) to authenticated;

create or replace function public.tc_followup_assign(p_followup uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f public.tc_followups;
begin
  select * into f from public.tc_followups where id = p_followup for update;
  if f.id is null or not (private.is_super_admin() or (private.my_role() = 'DEPARTMENT_HEAD' and f.department_id = private.my_department_id())
                          or (private.my_role() = 'TEAM_HEAD' and f.department_id = private.my_support_department_id())) then
    raise exception 'NOT_FOUND: Follow-up not found.' using errcode = 'P0001';
  end if;
  if f.status not in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE') then
    raise exception 'CONFLICT: This follow-up is finished.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                  where p.id = p_profile and p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = f.department_id and p.is_technical_consultant) then
    raise exception 'VALIDATION_ERROR: Choose an active Technical Consultant of this department.' using errcode = 'P0001';
  end if;
  update public.tc_followups set assigned_to = p_profile, updated_at = now() where id = p_followup;
  perform private.write_audit('TC_FOLLOWUP_ASSIGNED', 'customer', f.customer_id, f.department_id, null, jsonb_build_object('followup_id', f.id, 'assigned_to', p_profile));
  perform private.notify(p_profile, 'TC_FOLLOWUP_ASSIGNED', 'A consultation follow-up was assigned to you',
    format('%s', (select coalesce(c.company, c.name) from public.customers c where c.id = f.customer_id)), 'customer', f.customer_id);
end $$;
revoke all on function public.tc_followup_assign(uuid, uuid) from public, anon;
grant execute on function public.tc_followup_assign(uuid, uuid) to authenticated;

-- The scheduled job (service role; the API calls it from the dispatch run, never from a browser timer): revalidate every open follow-up against the
-- persisted customer, cancel the ones that no longer apply, and when one has become due notify the responsible user ONCE.
create or replace function public.tc_followups_process_due()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_cancelled integer := 0;
  v_due integer := 0;
  v_assignee uuid;
  v_recipient uuid;
  v_name text;
begin
  for r in
    select f.id, f.customer_id, f.department_id, f.status, f.due_at, f.assigned_to, c.lifecycle_stage, c.department_id as current_department,
           coalesce(c.company, c.name) as customer_name
      from public.tc_followups f left join public.customers c on c.id = f.customer_id
     where f.status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE')
     for update of f skip locked
  loop
    if r.lifecycle_stage is null or r.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') or r.current_department is distinct from r.department_id then
      update public.tc_followups set status = 'CANCELLED', cancelled_at = now(), cancelled_reason = 'The customer is no longer eligible.', updated_at = now() where id = r.id;
      v_cancelled := v_cancelled + 1;
      continue;
    end if;
    if r.status = 'SCHEDULED' and r.due_at <= now() then
      -- the assignee must still be an active consultant of the department
      v_assignee := case when exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                                       where p.id = r.assigned_to and p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = r.department_id and p.is_technical_consultant)
                         then r.assigned_to else private.pick_consultant(r.department_id) end;
      update public.tc_followups set status = 'DUE', due_notified_at = now(), assigned_to = v_assignee, updated_at = now()
       where id = r.id and status = 'SCHEDULED' and due_notified_at is null;
      if found then
        v_due := v_due + 1;
        if v_assignee is not null then
          perform private.notify(v_assignee, 'TC_FOLLOWUP_DUE', format('Consultation due: %s', r.customer_name), 'The consultation follow-up with this customer is due. Contact the customer and record the outcome.', 'customer', r.customer_id);
        else
          -- nobody to contact the customer: the Department Head is told
          for v_recipient in select p.id from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE' and p.department_id = r.department_id loop
            perform private.notify(v_recipient, 'TC_FOLLOWUP_DUE', format('Consultation due, no consultant: %s', r.customer_name), 'This customer is due for the consultation but the department has no active Technical Consultant.', 'customer', r.customer_id);
          end loop;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('cancelled', v_cancelled, 'due', v_due);
end $$;
revoke all on function public.tc_followups_process_due() from public, anon, authenticated;
grant execute on function public.tc_followups_process_due() to service_role;

notify pgrst, 'reload schema';
