-- =============================================================================
-- The Super Admin account is the top of the hierarchy (Super Admin -> Department Head -> Team Lead -> Team Member) and cannot be
-- suspended, revoked, deleted or demoted from the application by anybody - not by a Department Head, a Team Lead, a Team Member and
-- not by another Super Admin or by itself.
--
-- The workflow functions already refuse it (private.actor_can_manage_profile: a Super Admin may manage everybody EXCEPT a Super Admin; a
-- Department Head only Team Leads and Team Members of the department; a Team Lead only Team Members of the team). This migration adds a
-- last line of defence IN THE TABLE, so a future function, a policy mistake or a hand-made request cannot get round them:
--   * UPDATE of role or status of a SUPER_ADMIN row, and DELETE of one, are refused whenever the statement runs for a signed-in person
--     (auth.uid() is set). Maintenance by the database owner / service role (auth.uid() is null: migrations, break-glass recovery) is not affected.
--   * a profile can never be turned INTO a Super Admin by a signed-in person either (the role stays "never assignable through the app").
-- Additive: two trigger functions and two triggers. No data changes.
-- =============================================================================
create or replace function private.tg_protect_super_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return case tg_op when 'DELETE' then old else new end;   -- database owner / service role: not a request of a signed-in person
  end if;
  if tg_op = 'DELETE' then
    if old.role = 'SUPER_ADMIN' then
      raise exception 'FORBIDDEN: The Super Admin account cannot be deleted from the application.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.role = 'SUPER_ADMIN' and (new.role is distinct from old.role or new.status is distinct from old.status) then
    raise exception 'FORBIDDEN: The Super Admin account cannot be suspended, revoked or demoted from the application.' using errcode = '42501';
  end if;
  if old.role <> 'SUPER_ADMIN' and new.role = 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Nobody can be made Super Admin from the application.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_protect_super_admin() from public, anon, authenticated;

drop trigger if exists profiles_protect_super_admin_update on public.profiles;
create trigger profiles_protect_super_admin_update
  before update of role, status on public.profiles
  for each row execute function private.tg_protect_super_admin();

drop trigger if exists profiles_protect_super_admin_delete on public.profiles;
create trigger profiles_protect_super_admin_delete
  before delete on public.profiles
  for each row execute function private.tg_protect_super_admin();
