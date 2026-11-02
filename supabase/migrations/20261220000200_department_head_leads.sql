-- A Department Head can add leads of their own, like a Team Member does.
--
-- Until now every lead needed an owner who belongs to a team, and a Department Head belongs to a department, not a team, so a head could not add a lead. A head's own
-- leads are now placed in the Sales team of their department (their side's team; the first one when there are several) - the lead keeps its department, is visible to
-- the head and to the Super Admin as before, and shows in the department's Sales figures. Only a Department Head gets this: every other owner must still belong to a team.
-- Safe to run again.

create or replace function private.lead_team_of(p_owner uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select t.id from public.profiles p
    join public.teams t on t.department_id = private.base_department(p.department_id) and not t.is_pool
   where p.id = p_owner and p.role = 'DEPARTMENT_HEAD' and p.team_id is null
     and t.division::text = coalesce(p.head_division, 'SALES')
   order by t.created_at, t.id
   limit 1
$$;
revoke all on function private.lead_team_of(uuid) from public, anon, authenticated;

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
    if v_owner.id is null or v_owner.status <> 'ACTIVE' or (v_owner.team_id is null and private.lead_team_of(v_owner.id) is null) then
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
  if v_owner.team_id is null and private.lead_team_of(v_owner.id) is null then
    raise exception 'VALIDATION_ERROR: Customer owner no longer belongs to a team.' using errcode = 'P0001';
  end if;
  new.team_id := coalesce(v_owner.team_id, private.lead_team_of(v_owner.id));
  -- a head's own lead sits in the department that owns the team (a head of a Sales / Support side department such as Wabatalk leads the base department's team)
  new.department_id := case when v_owner.team_id is null then (select t.department_id from public.teams t where t.id = new.team_id) else v_owner.department_id end;

  new.email := nullif(lower(trim(new.email)), '');
  new.phone := nullif(trim(new.phone), '');
  new.updated_at := now();
  new.updated_by := coalesce((select id from public.profiles where id = auth.uid()), new.updated_by);
  return new;
end $$;

create or replace function private.can_assign_customer_owner(p_owner uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_owner public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  select * into v_owner from public.profiles where id = p_owner and status = 'ACTIVE';
  if v_me.id is null or v_owner.id is null or (v_owner.team_id is null and private.lead_team_of(v_owner.id) is null) then
    return false;
  end if;
  return case v_me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then v_owner.department_id = private.scoped_department(v_me.id, v_me.department_id)
    when 'TEAM_HEAD' then v_owner.team_id = v_me.team_id
    when 'TEAM_MEMBER' then v_owner.id = v_me.id
    else false
  end;
end $$;

notify pgrst, 'reload schema';
