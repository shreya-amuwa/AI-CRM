-- =============================================================================
-- Security hardening (additive, safe to rerun in the Supabase SQL editor; no data is deleted or changed)
--
--  1. Leads (crm_leads) and blueprint requests were readable and writable by ANY active staff member of ANY department.
--     They are now scoped: Super Admin, the Amuwa Corporation (HQ) department, the lead's own department, or the member
--     the lead is assigned to.
--  2. The two legacy storage buckets were PUBLIC (anyone with a link could read the files). They become private.
--  3. Least privilege: nobody signed-out (anon) holds table privileges; nobody holds TRUNCATE / REFERENCES / TRIGGER on
--     CRM tables; functions are no longer executable by signed-out visitors except the sign-up options list.
--  4. Audit trail: record_security_event() (server only) for webhook / sign-in events, and audit metadata is scrubbed so a
--     password, token or secret can never be written to the audit log.
--  5. Sign-in protection: failed sign-ins are counted per account; 5 failures in 15 minutes lock the account for the rest
--     of the window and are audited (LOGIN_FAILED / LOGIN_LOCKED). It is a Supabase Auth "password verification" hook:
--     enable it once in the dashboard (Authentication > Hooks), see docs/SECURITY.md. Harmless until enabled.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Department-scoped leads and requirements
-- ---------------------------------------------------------------------------
create or replace function private.my_department_slug()
returns text language sql stable security definer set search_path = '' as $$
  select d.slug from public.profiles p join public.departments d on d.id = p.department_id
   where p.id = auth.uid() and p.status = 'ACTIVE'
$$;
revoke all on function private.my_department_slug() from public, anon;
grant execute on function private.my_department_slug() to authenticated, service_role;

-- Can the signed-in user see / change a row that belongs to this department (a slug)?
create or replace function private.can_use_department_slug(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.my_id()) is not null and (
    (select private.is_super_admin())
    or (select private.my_department_slug()) = 'amuwa'           -- Amuwa Corporation (head office) sees all units
    or p_slug is not distinct from (select private.my_department_slug())
  )
$$;
revoke all on function private.can_use_department_slug(text) from public, anon;
grant execute on function private.can_use_department_slug(text) to authenticated, service_role;

drop policy if exists crm_leads_active_users on public.crm_leads;
drop policy if exists crm_leads_department_scope on public.crm_leads;
create policy crm_leads_department_scope on public.crm_leads for all to authenticated
  using (private.can_use_department_slug(department) or assigned_to = (select private.my_id()))
  with check (private.can_use_department_slug(department) or assigned_to = (select private.my_id()));

drop policy if exists blueprint_requirements_active_users on public.blueprint_requirements;
drop policy if exists blueprint_requirements_department_scope on public.blueprint_requirements;
create policy blueprint_requirements_department_scope on public.blueprint_requirements for all to authenticated
  using (private.can_use_department_slug(department_id))
  with check (private.can_use_department_slug(department_id));

-- ---------------------------------------------------------------------------
-- 2. Legacy storage buckets: private (the objects stay where they are; nothing in the app links to them)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set public = false where id in ('blueprint-files', 'amuwa-docs') and public;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Least privilege
-- ---------------------------------------------------------------------------
-- Signed-out visitors need no table at all (sign-up options come from a function).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- Signed-in users never need TRUNCATE (it ignores Row Level Security), REFERENCES or TRIGGER.
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Reference tables the app only reads.
revoke insert, update, delete on public.onboarding_items, public.onboarding_item_services,
  public.customer_onboarding_entries, public.onboarding_automation_runs from authenticated;

-- Functions: only list_registration_options() is meant for signed-out visitors.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'list_registration_options'
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
-- New tables / functions of this project do not start with signed-out access.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 4. Audit log: scrubbed metadata + a server-only way to record security events
-- ---------------------------------------------------------------------------
create or replace function private.scrub_audit_metadata(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case jsonb_typeof(p)
    when 'object' then coalesce((
      select jsonb_object_agg(e.key, private.scrub_audit_metadata(e.value))
        from jsonb_each(p) e
       where e.key !~* '(password|passwd|pwd|secret|token|authorization|apikey|api_key|cookie|credential)'), '{}'::jsonb)
    when 'array' then coalesce((select jsonb_agg(private.scrub_audit_metadata(v)) from jsonb_array_elements(p) v), '[]'::jsonb)
    else p
  end
$$;
revoke all on function private.scrub_audit_metadata(jsonb) from public, anon;
grant execute on function private.scrub_audit_metadata(jsonb) to authenticated, service_role;

create or replace function private.write_audit(
  p_action text, p_entity_type text, p_entity_id uuid,
  p_department_id uuid, p_team_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values ((select id from public.profiles where id = auth.uid()), p_action, p_entity_type, p_entity_id,
          p_department_id, p_team_id, private.scrub_audit_metadata(coalesce(p_metadata, '{}'::jsonb)))
$$;
revoke execute on function private.write_audit(text, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- The API server (service role) records events that have no signed-in user: rejected webhooks, sign-in problems.
create or replace function public.record_security_event(p_action text, p_entity_type text default 'security', p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_action !~ '^[A-Z][A-Z0-9_]{1,63}$' or p_entity_type !~ '^[a-z_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: Invalid security event.' using errcode = 'P0001';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (null, p_action, p_entity_type, left(private.scrub_audit_metadata(coalesce(p_metadata, '{}'::jsonb))::text, 4000)::jsonb);
exception when invalid_text_representation then
  insert into public.audit_logs (actor_id, action, entity_type, metadata) values (null, p_action, p_entity_type, '{"truncated":true}'::jsonb);
end $$;
revoke all on function public.record_security_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_security_event(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Sign-in protection (Supabase Auth "password verification attempt" hook)
-- ---------------------------------------------------------------------------
create table if not exists public.auth_login_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_login_attempts_user_idx on public.auth_login_attempts (user_id, created_at desc);
alter table public.auth_login_attempts enable row level security;
revoke all on public.auth_login_attempts from public, anon, authenticated;

-- event: {"user_id": "...", "valid": true|false}. Returns {"decision": "continue" | "reject", "message": "..."}.
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_valid boolean := coalesce((event ->> 'valid')::boolean, false);
  v_failed integer;
  c_max constant integer := 5;
  c_window constant interval := interval '15 minutes';
begin
  begin
    v_user := (event ->> 'user_id')::uuid;
  exception when others then
    return jsonb_build_object('decision', 'continue');
  end;
  if v_user is null then
    return jsonb_build_object('decision', 'continue');
  end if;

  delete from public.auth_login_attempts where created_at < now() - interval '1 day';
  select count(*) into v_failed from public.auth_login_attempts where user_id = v_user and created_at > now() - c_window;

  if v_failed >= c_max then
    -- locked for the rest of the window, whatever password is typed (a correct guess after many wrong ones is not trusted)
    return jsonb_build_object('decision', 'reject',
      'message', 'Too many failed sign-in attempts. Please wait 15 minutes and try again, or ask your administrator.');
  end if;

  if v_valid then
    delete from public.auth_login_attempts where user_id = v_user;
    return jsonb_build_object('decision', 'continue');
  end if;

  insert into public.auth_login_attempts (user_id) values (v_user);
  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values ((select id from public.profiles where id = v_user), 'LOGIN_FAILED', 'auth', jsonb_build_object('userId', v_user, 'attempt', v_failed + 1));
  if v_failed + 1 >= c_max then
    insert into public.audit_logs (actor_id, action, entity_type, metadata)
    values ((select id from public.profiles where id = v_user), 'LOGIN_LOCKED', 'auth', jsonb_build_object('userId', v_user, 'minutes', 15));
  end if;
  return jsonb_build_object('decision', 'continue');
end $$;
revoke all on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
  end if;
end $$;

notify pgrst, 'reload schema';
