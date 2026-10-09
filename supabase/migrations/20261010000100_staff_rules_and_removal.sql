-- =============================================================================
-- Staff rules.
--
--  1. One Department Head per department. A second one cannot be created,
--     promoted or moved in (suspended heads still count; revoked or rejected
--     ones do not). Existing duplicates are left alone until they change.
--  2. Managers remove people below them (delete_user): Super Admin anyone,
--     Department Head their department's team leads and members, Team Lead
--     their team's members. Customers the person owned move to an active Team
--     Lead of the same team (or the person removing them, if they have a team);
--     otherwise removal is refused with a clear message.
--  3. WABA ID must be numbers only, at least 12 digits.
-- Additive / idempotent. Run the whole file at once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. One Department Head per department
-- ---------------------------------------------------------------------------
create or replace function private.department_head_of(p_department uuid, p_exclude uuid default null)
returns public.profiles language sql stable security definer set search_path = '' as $$
  select * from public.profiles
   where role = 'DEPARTMENT_HEAD' and department_id = p_department
     and status in ('ACTIVE', 'SUSPENDED', 'PENDING') and id is distinct from p_exclude
   order by created_at
   limit 1
$$;
grant execute on function private.department_head_of(uuid, uuid) to authenticated;

create or replace function private.tg_profiles_one_department_head()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.profiles;
begin
  if new.role <> 'DEPARTMENT_HEAD' or new.department_id is null or new.status in ('REVOKED', 'REJECTED') then
    return new;
  end if;
  -- Only check when someone becomes a head of this department (not on other edits).
  if tg_op = 'UPDATE' and old.role = 'DEPARTMENT_HEAD' and old.department_id is not distinct from new.department_id
     and old.status not in ('REVOKED', 'REJECTED') then
    return new;
  end if;
  v_existing := private.department_head_of(new.department_id, new.id);
  if v_existing.id is not null then
    raise exception 'CONFLICT: This department already has a Department Head (%). A department can have only one.', v_existing.full_name
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_one_department_head() from public, anon, authenticated;

drop trigger if exists profiles_one_department_head on public.profiles;
create trigger profiles_one_department_head before insert or update on public.profiles
  for each row execute function private.tg_profiles_one_department_head();

-- Checked before the login is created, so the manager sees the reason.
create or replace function public.assert_can_create_user(
  p_role public.app_role, p_department_id uuid default null, p_team_id uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_existing public.profiles;
begin
  if not private.actor_can_assign_role(auth.uid(), p_role, p_department_id, p_team_id) then
    raise exception 'FORBIDDEN: You are not allowed to create a % here.', replace(p_role::text, '_', ' ')
      using errcode = '42501';
  end if;
  if p_role = 'DEPARTMENT_HEAD' then
    v_existing := private.department_head_of(p_department_id);
    if v_existing.id is not null then
      raise exception 'CONFLICT: This department already has a Department Head (%). A department can have only one.', v_existing.full_name
        using errcode = 'P0001';
    end if;
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Remove a person (hierarchy-scoped)
-- ---------------------------------------------------------------------------
create or replace function public.delete_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.profiles;
  v_heir uuid;
  v_moved integer := 0;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') then
    raise exception 'FORBIDDEN: Only a Super Admin, Department Head or Team Lead can remove people.' using errcode = '42501';
  end if;
  if not private.can_manage_profile(p_user_id) then
    raise exception 'FORBIDDEN: You can only remove people below you in the hierarchy.' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_user_id;

  if exists (select 1 from public.customers where owner_id = t.id) then
    -- Hand the customers to an active Team Lead of the same team, else to the remover if they have a team.
    select p.id into v_heir from public.profiles p
     where p.team_id = t.team_id and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and p.id <> t.id
     order by (p.id = me.id) desc, p.created_at limit 1;
    if v_heir is null and me.team_id is not null and me.id <> t.id then
      v_heir := me.id;
    end if;
    if v_heir is null then
      raise exception 'CONFLICT: % still has customers and their team has no active Team Lead to take them over. Reassign the customers first.', t.full_name
        using errcode = 'P0001';
    end if;
    -- The owner trigger re-checks the hand-over; run it as a plain data move.
    update public.customers set owner_id = v_heir where owner_id = t.id;
    get diagnostics v_moved = row_count;
  end if;

  perform private.write_audit('USER_REMOVED', 'profile', t.id, t.department_id, t.team_id,
    jsonb_build_object('email', t.email, 'full_name', t.full_name, 'role', t.role,
                       'customers_moved_to', v_heir, 'customers_moved', v_moved));
  if v_heir is not null and v_heir <> me.id then
    perform private.notify(v_heir, 'CUSTOMERS_REASSIGNED', format('%s customer(s) moved to you', v_moved),
      format('%s was removed by %s; their customers are now yours.', t.full_name, me.full_name));
  end if;
  delete from auth.users where id = t.id;
end $$;
revoke all on function public.delete_user(uuid) from public, anon;
grant execute on function public.delete_user(uuid) to authenticated, service_role;

-- Removing a person sets customers.created_by to null (FK); the customers
-- trigger used to put the old value back, which made the removal fail.
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
    -- Keep the creator, unless their account was just removed (FK sets it to null).
    new.created_by := case
      when new.created_by is null and not exists (select 1 from public.profiles where id = old.created_by) then null
      else old.created_by end;
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

-- ---------------------------------------------------------------------------
-- 3. WABA ID: numbers only, at least 12 digits
-- ---------------------------------------------------------------------------
create or replace function private.tg_onboarding_entries_waba_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.item_code = 'WABA_ID' and new.value is not null then
    new.value := regexp_replace(new.value, '\s', '', 'g');
    if new.value !~ '^[0-9]{12,20}$' then
      raise exception 'VALIDATION_ERROR: WABA ID must be numbers only, at least 12 digits.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_onboarding_entries_waba_id() from public, anon, authenticated;
drop trigger if exists onboarding_entries_waba_id on public.customer_onboarding_entries;
create trigger onboarding_entries_waba_id before insert or update of value on public.customer_onboarding_entries
  for each row execute function private.tg_onboarding_entries_waba_id();
