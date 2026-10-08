-- =============================================================================
-- "Technical Consultant" as its own choice when creating staff.
--
-- The client-onboarding (Technical Consultant) dashboard used to open for
-- every team member of a SUPPORT team. It now opens only for staff created
-- (or marked) as Technical Consultant; other support team members get the
-- normal team member dashboard.
--
--  * profiles.is_technical_consultant — only for a TEAM_MEMBER of a SUPPORT
--    team (cleared automatically if the role or team changes)
--  * staff created through the API with app_metadata
--    provisioned_technical_consultant = true become consultants
--  * set_technical_consultant(user, value) — switch an existing member
--  * review rights (private.my_support_department_id) and "sent to the
--    Technical Consultant" notifications go to consultants (and support team
--    leads) only
--  * existing ACTIVE support team members are kept as consultants so current
--    consultant logins keep working; switch any of them back from Team Members.
-- Additive / idempotent.
-- =============================================================================

alter table public.profiles
  add column if not exists is_technical_consultant boolean not null default false;

-- Keep the flag valid: only a TEAM_MEMBER of a SUPPORT team can carry it.
create or replace function private.tg_profiles_consultant_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_technical_consultant and (
       new.role <> 'TEAM_MEMBER'
       or not exists (select 1 from public.teams t where t.id = new.team_id and t.division = 'SUPPORT')) then
    new.is_technical_consultant := false;
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_consultant_flag() from public, anon, authenticated;

drop trigger if exists profiles_consultant_flag on public.profiles;
create trigger profiles_consultant_flag before insert or update on public.profiles
  for each row execute function private.tg_profiles_consultant_flag();

-- Existing support team members were using the consultant dashboard.
update public.profiles p set is_technical_consultant = true
  from public.teams t
 where t.id = p.team_id and t.division = 'SUPPORT' and p.role = 'TEAM_MEMBER'
   and p.status = 'ACTIVE' and not p.is_technical_consultant;

-- Staff created through the API: runs after on_auth_user_created (triggers
-- fire in name order), once the profile exists.
create or replace function private.tg_auth_user_technical_consultant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_profile public.profiles;
begin
  if not coalesce((v_app ->> 'provisioned_technical_consultant')::boolean, false) then
    return new;
  end if;
  update public.profiles set is_technical_consultant = true where id = new.id returning * into v_profile;
  if v_profile.id is null or not v_profile.is_technical_consultant then
    raise exception 'VALIDATION_ERROR: A Technical Consultant must be a team member of a support team.' using errcode = 'P0001';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values (private.try_uuid(v_app ->> 'provisioned_by'), 'TECHNICAL_CONSULTANT_SET', 'profile', v_profile.id,
          v_profile.department_id, v_profile.team_id, jsonb_build_object('value', true));
  return new;
end $$;
revoke all on function private.tg_auth_user_technical_consultant() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_technical_consultant on auth.users;
create trigger on_auth_user_created_technical_consultant after insert on auth.users
  for each row execute function private.tg_auth_user_technical_consultant();

-- Switch an existing support team member to / from Technical Consultant.
create or replace function public.set_technical_consultant(p_user_id uuid, p_value boolean)
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
    raise exception 'VALIDATION_ERROR: Only a team member of a support team can be a Technical Consultant.' using errcode = 'P0001';
  end if;

  update public.profiles set is_technical_consultant = coalesce(p_value, false)
   where id = p_user_id returning * into v_target;
  perform private.write_audit('TECHNICAL_CONSULTANT_SET', 'profile', p_user_id, v_target.department_id, v_target.team_id,
    jsonb_build_object('value', v_target.is_technical_consultant));
  return v_target;
end $$;
revoke all on function public.set_technical_consultant(uuid, boolean) from public, anon;
grant execute on function public.set_technical_consultant(uuid, boolean) to authenticated, service_role;

-- Review rights: Technical Consultants (and support team leads) only.
create or replace function private.my_support_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p join public.teams t on t.id = p.team_id
  where p.id = auth.uid() and p.status = 'ACTIVE' and t.division = 'SUPPORT'
    and (p.is_technical_consultant or p.role = 'TEAM_HEAD')
$$;
grant execute on function private.my_support_department_id() to authenticated;

-- Same as 20261008000200, except the notification goes to Technical
-- Consultants (and support team leads) instead of every support member.
create or replace function public.forward_onboarding_to_support(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_missing text;
  v_recipient uuid;
  v_again boolean;
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
  select returned_at is not null into v_again from public.customer_onboarding where customer_id = p_id;

  update public.customer_onboarding
     set stage = 'SETUP', forwarded_to_support_at = now(), forwarded_by = (select private.my_id()),
         returned_at = null, returned_by = null, return_note = null
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'FORWARDED_TO_SUPPORT',
    case when v_again then 'Fixed and sent again to the Technical Consultant' else 'Sent to the Technical Consultant for verification' end);
  perform private.write_audit('ONBOARDING_FORWARDED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('resubmitted', coalesce(v_again, false)));

  for v_recipient in
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
    where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
      and (p.is_technical_consultant or p.role = 'TEAM_HEAD')
  loop
    perform private.notify(v_recipient, 'ONBOARDING_FORWARDED',
      format(case when v_again then 'Re-verify: %s' else 'New customer to verify: %s' end, coalesce(v.company, v.name)),
      case when v_again then 'Sales fixed the items you sent back.' else 'Sales has sent the customer''s details and documents for verification.' end,
      'customer', p_id);
  end loop;
end $$;
revoke all on function public.forward_onboarding_to_support(uuid) from public, anon;
grant execute on function public.forward_onboarding_to_support(uuid) to authenticated;
