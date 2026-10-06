-- =============================================================================
-- Domain triggers. Because these run inside the database they apply to every
-- write path (API, direct PostgREST, SQL editor, service role):
--   * account-status state machine
--   * customer ownership / organisational context derivation
--   * audit logging and notifications
--   * profile + approval request creation on sign-up / provisioning
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Profiles: status state machine + bookkeeping
-- ---------------------------------------------------------------------------
create or replace function private.tg_profiles_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'PENDING'   and new.status in ('ACTIVE', 'REJECTED')) or
      (old.status = 'ACTIVE'    and new.status in ('SUSPENDED', 'REVOKED')) or
      (old.status = 'SUSPENDED' and new.status in ('ACTIVE', 'REVOKED')) or
      (old.status = 'REVOKED'   and new.status = 'ACTIVE')
    ) then
      raise exception 'VALIDATION_ERROR: Cannot change account status from % to %.', old.status, new.status
        using errcode = 'P0001';
    end if;
    new.status_changed_at := now();
    new.status_changed_by := (select id from public.profiles where id = auth.uid());
    if old.status = 'PENDING' and new.status = 'ACTIVE' then
      new.approved_at := now();
      new.approved_by := new.status_changed_by;
    end if;
  end if;
  return new;
end $$;

create trigger profiles_before_update before update on public.profiles
  for each row execute function private.tg_profiles_before_update();

create or replace function private.tg_profiles_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_action text;
  v_title text;
begin
  if new.status is distinct from old.status then
    v_action := case
      when old.status = 'PENDING' and new.status = 'ACTIVE' then 'USER_APPROVED'
      when new.status = 'REJECTED' then 'USER_REJECTED'
      when new.status = 'SUSPENDED' then 'USER_SUSPENDED'
      when new.status = 'REVOKED' then 'USER_REVOKED'
      else 'USER_REINSTATED'
    end;
    v_title := case v_action
      when 'USER_APPROVED' then 'Your account has been approved'
      when 'USER_REJECTED' then 'Your registration was declined'
      when 'USER_SUSPENDED' then 'Your account has been suspended'
      when 'USER_REVOKED' then 'Your access has been revoked'
      else 'Your access has been restored'
    end;
    perform private.write_audit(v_action, 'profile', new.id, new.department_id, new.team_id,
      jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.status_reason));
    perform private.notify(new.id, v_action, v_title, coalesce(new.status_reason, ''), 'profile', new.id);
  end if;

  if new.role is distinct from old.role then
    perform private.write_audit('ROLE_CHANGED', 'profile', new.id, new.department_id, new.team_id,
      jsonb_build_object('from', old.role, 'to', new.role));
    perform private.notify(new.id, 'ROLE_CHANGED', 'Your role has changed',
      format('Your role is now %s.', replace(new.role::text, '_', ' ')), 'profile', new.id);
  end if;

  if new.team_id is not null and new.status = 'ACTIVE'
     and (new.team_id is distinct from old.team_id or old.status <> 'ACTIVE') then
    perform private.write_audit('TEAM_MEMBER_ADDED', 'team', new.team_id, new.department_id, new.team_id,
      jsonb_build_object('user_id', new.id, 'previous_team_id', old.team_id));
  elsif new.department_id is distinct from old.department_id or new.team_id is distinct from old.team_id then
    perform private.write_audit('USER_ASSIGNMENT_CHANGED', 'profile', new.id, new.department_id, new.team_id,
      jsonb_build_object('from_department_id', old.department_id, 'from_team_id', old.team_id,
                         'to_department_id', new.department_id, 'to_team_id', new.team_id));
  end if;
  return null;
end $$;

create trigger profiles_after_update after update on public.profiles
  for each row execute function private.tg_profiles_after_update();

create or replace function private.tg_profiles_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_audit('USER_DELETED', 'profile', old.id, old.department_id, old.team_id,
    jsonb_build_object('email', old.email, 'full_name', old.full_name, 'role', old.role));
  return null;
end $$;

create trigger profiles_after_delete after delete on public.profiles
  for each row execute function private.tg_profiles_after_delete();

-- ---------------------------------------------------------------------------
-- Sign-up / provisioning: auth.users → profiles (+ approval request)
--
--   * Self-registration: role is ALWAYS TEAM_MEMBER and status PENDING. The
--     requested department/team come from user metadata and are validated.
--   * Admin provisioning: the API sets raw_app_meta_data (writable only with
--     the service-role key). The provisioning actor's rights are re-checked
--     here, so even the backend cannot create a role the actor may not grant.
--   * Bootstrap: app_metadata.bootstrap_super_admin creates the first Super
--     Admin only while no Super Admin exists.
-- ---------------------------------------------------------------------------
create or replace function private.route_registration_request(p_request public.approval_requests, p_subject public.profiles)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
  v_count integer := 0;
  v_title text := format('New account request: %s', p_subject.full_name);
  v_body text := format('%s (%s) registered and is waiting for approval.', p_subject.full_name, p_subject.email);
begin
  for v_recipient in
    select p.id from public.profiles p
    where p.status = 'ACTIVE' and (
      (p.role = 'TEAM_HEAD' and p_request.team_id is not null and p.team_id = p_request.team_id) or
      (p.role = 'DEPARTMENT_HEAD' and p_request.department_id is not null and p.department_id = p_request.department_id))
  loop
    perform private.notify(v_recipient, 'USER_REGISTRATION_REQUEST', v_title, v_body,
      'approval_request', p_request.id, jsonb_build_object('subject_user_id', p_subject.id), 'urgent');
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then  -- nobody in the hierarchy yet: escalate to Super Admins
    for v_recipient in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN' loop
      perform private.notify(v_recipient, 'USER_REGISTRATION_REQUEST', v_title, v_body,
        'approval_request', p_request.id, jsonb_build_object('subject_user_id', p_subject.id), 'urgent');
    end loop;
  end if;
end $$;

create or replace function private.tg_handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_email text := lower(new.email);
  v_name text := left(coalesce(nullif(trim(v_meta ->> 'full_name'), ''), split_part(lower(new.email), '@', 1)), 160);
  v_actor uuid;
  v_role public.app_role;
  v_department uuid;
  v_team uuid;
  v_profile public.profiles;
  v_request public.approval_requests;
begin
  if v_email is null then
    raise exception 'VALIDATION_ERROR: An e-mail address is required.' using errcode = 'P0001';
  end if;

  -- 1. Bootstrap the first Super Admin
  if coalesce((v_app ->> 'bootstrap_super_admin')::boolean, false) then
    if exists (select 1 from public.profiles where role = 'SUPER_ADMIN') then
      raise exception 'FORBIDDEN: A Super Admin already exists.' using errcode = '42501';
    end if;
    insert into public.profiles (id, email, full_name, role, status, approved_at)
    values (new.id, v_email, v_name, 'SUPER_ADMIN', 'ACTIVE', now()) returning * into v_profile;
    perform private.write_audit('USER_CREATED', 'profile', v_profile.id, null, null,
      jsonb_build_object('role', 'SUPER_ADMIN', 'bootstrap', true));
    return new;
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
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise exception 'FORBIDDEN: You are not allowed to create this user.' using errcode = '42501';
    end if;

    insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, approved_by, approved_at)
    values (new.id, v_email, v_name, nullif(trim(v_meta ->> 'position'), ''), v_role, 'ACTIVE',
            v_department, v_team, v_actor, now())
    returning * into v_profile;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
    values (v_actor, 'USER_CREATED', 'profile', v_profile.id, v_department, v_team,
            jsonb_build_object('role', v_role, 'email', v_email));
    if v_team is not null then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TEAM_MEMBER_ADDED', 'team', v_team, v_department, v_team, jsonb_build_object('user_id', v_profile.id));
    end if;
    return new;
  end if;

  -- 3. Self-registration → PENDING team member awaiting approval
  select d.id into v_department from public.departments d
  where d.id = private.try_uuid(v_meta ->> 'department_id') and not d.is_locked;
  select t.id into v_team from public.teams t
  where t.id = private.try_uuid(v_meta ->> 'team_id') and t.department_id = v_department;

  insert into public.profiles (id, email, full_name, role, status, department_id, team_id)
  values (new.id, v_email, v_name, 'TEAM_MEMBER', 'PENDING', v_department, v_team)
  returning * into v_profile;

  insert into public.approval_requests (request_type, subject_user_id, department_id, team_id)
  values ('USER_REGISTRATION', v_profile.id, v_department, v_team)
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values (v_profile.id, 'USER_REGISTERED', 'profile', v_profile.id, v_department, v_team,
          jsonb_build_object('approval_request_id', v_request.id));

  perform private.route_registration_request(v_request, v_profile);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.tg_handle_new_auth_user();

create or replace function private.tg_sync_auth_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.tg_sync_auth_email();

-- ---------------------------------------------------------------------------
-- Customers: ownership + organisational context + audit + notifications
-- ---------------------------------------------------------------------------
create or replace function private.tg_customers_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner public.profiles;
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    new.created_at := now();
    new.created_by := (select id from public.profiles where id = auth.uid());
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;

  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    select * into v_owner from public.profiles where id = new.owner_id;
    if v_owner.id is null or v_owner.status <> 'ACTIVE' or v_owner.team_id is null then
      raise exception 'VALIDATION_ERROR: Customer owner must be an active user who belongs to a team.'
        using errcode = 'P0001';
    end if;
    if auth.uid() is not null and not private.can_assign_customer_owner(new.owner_id) then
      raise exception 'FORBIDDEN: You cannot assign customers to this user.' using errcode = '42501';
    end if;
  else
    select * into v_owner from public.profiles where id = new.owner_id;
  end if;
  -- Organisational context always mirrors the owner's current placement.
  if v_owner.team_id is null then
    raise exception 'VALIDATION_ERROR: Customer owner no longer belongs to a team.' using errcode = 'P0001';
  end if;
  new.team_id := v_owner.team_id;
  new.department_id := v_owner.department_id;

  new.email := nullif(lower(trim(new.email)), '');
  new.phone := nullif(trim(new.phone), '');
  new.updated_at := now();
  new.updated_by := coalesce((select id from public.profiles where id = auth.uid()), new.updated_by);
  return new;
end $$;

create trigger customers_before_write before insert or update on public.customers
  for each row execute function private.tg_customers_before_write();

create or replace function private.tg_customers_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('CUSTOMER_CREATED', 'customer', new.id, new.department_id, new.team_id,
      jsonb_build_object('name', new.name, 'owner_id', new.owner_id));
    for v_recipient in
      select p.id from public.profiles p
      where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.team_id = new.team_id
    loop
      perform private.notify(v_recipient, 'CUSTOMER_CREATED', format('New customer: %s', new.name),
        coalesce(new.company, ''), 'customer', new.id, jsonb_build_object('owner_id', new.owner_id));
    end loop;
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform private.write_audit('CUSTOMER_DELETED', 'customer', old.id, old.department_id, old.team_id,
      jsonb_build_object('snapshot', to_jsonb(old) - 'search_text'));
    return null;
  end if;

  -- UPDATE: record only changed columns
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)), '{}'::jsonb)
    into v_changes
  from jsonb_each(to_jsonb(new) - array['updated_at', 'updated_by', 'search_text']) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value;

  if v_changes = '{}'::jsonb then
    return null;
  end if;

  if new.owner_id is distinct from old.owner_id then
    perform private.write_audit('CUSTOMER_REASSIGNED', 'customer', new.id, new.department_id, new.team_id,
      jsonb_build_object('changes', v_changes));
    perform private.notify(new.owner_id, 'CUSTOMER_ASSIGNED', format('Customer assigned to you: %s', new.name),
      '', 'customer', new.id);
  else
    perform private.write_audit('CUSTOMER_UPDATED', 'customer', new.id, new.department_id, new.team_id,
      jsonb_build_object('changes', v_changes));
    perform private.notify(new.owner_id, 'CUSTOMER_UPDATED', format('Customer updated: %s', new.name),
      '', 'customer', new.id);
  end if;
  return null;
end $$;

create trigger customers_after_write after insert or update or delete on public.customers
  for each row execute function private.tg_customers_after_write();

create or replace function private.tg_customer_activities_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.actor_id := (select id from public.profiles where id = auth.uid());
  new.created_at := now();
  return new;
end $$;

create trigger customer_activities_before_insert before insert on public.customer_activities
  for each row execute function private.tg_customer_activities_before_insert();

-- ---------------------------------------------------------------------------
-- Departments / teams audit
-- ---------------------------------------------------------------------------
create or replace function private.tg_org_unit_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entity text := case tg_table_name when 'departments' then 'department' else 'team' end;
  v_prefix text := upper(v_entity);
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_department uuid := case when tg_table_name = 'departments' then (v_row ->> 'id')::uuid
                            else (v_row ->> 'department_id')::uuid end;
  v_team uuid := case when tg_table_name = 'teams' then (v_row ->> 'id')::uuid end;
begin
  perform private.write_audit(
    v_prefix || case tg_op when 'INSERT' then '_CREATED' when 'UPDATE' then '_UPDATED' else '_DELETED' end,
    v_entity, (v_row ->> 'id')::uuid,
    case when tg_op = 'DELETE' then null else v_department end,
    case when tg_op = 'DELETE' then null else v_team end,
    case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
         else jsonb_build_object('record', v_row) end);
  return null;
end $$;

create or replace function private.tg_org_unit_set_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := (select id from public.profiles where id = auth.uid());
  return new;
end $$;

create trigger departments_set_creator before insert on public.departments
  for each row execute function private.tg_org_unit_set_creator();
create trigger teams_set_creator before insert on public.teams
  for each row execute function private.tg_org_unit_set_creator();
create trigger departments_audit after insert or update or delete on public.departments
  for each row execute function private.tg_org_unit_audit();
create trigger teams_audit after insert or update or delete on public.teams
  for each row execute function private.tg_org_unit_audit();
