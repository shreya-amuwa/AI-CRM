-- =============================================================================
-- Row Level Security + least-privilege grants.
--
-- Supabase grants ALL on public tables to anon/authenticated by default, so
-- every table starts from REVOKE ALL and receives only the privileges its
-- policies need. Column-level grants make authorization columns (role,
-- status, department, team, ownership context, audit columns) unwritable
-- from the client; they change only through workflow functions/triggers.
--
-- Policies call helpers as `(select private.fn())` so Postgres evaluates them
-- once per statement (initPlan) rather than once per row.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['departments', 'teams', 'profiles', 'customers', 'customer_activities',
                           'approval_requests', 'notifications', 'audit_logs', 'crm_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

grant usage on type public.app_role, public.account_status, public.team_division, public.customer_segment,
  public.customer_status, public.approval_request_type, public.approval_status to authenticated;

-- ---------------------------------------------------------------------------
-- departments: visible to every active user; managed by Super Admin
-- ---------------------------------------------------------------------------
grant select on public.departments to authenticated;
grant insert (slug, name, description, category, icon_name, accent_color, logo_url, is_locked) on public.departments to authenticated;
grant update (name, description, category, icon_name, accent_color, logo_url, is_locked) on public.departments to authenticated;
grant delete on public.departments to authenticated;

create policy departments_select on public.departments for select to authenticated
  using ((select private.my_id()) is not null);
create policy departments_insert on public.departments for insert to authenticated
  with check ((select private.is_super_admin()));
create policy departments_update on public.departments for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
create policy departments_delete on public.departments for delete to authenticated
  using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- teams: Super Admin everywhere; everyone else sees their department's teams;
-- department heads manage teams in their department
-- ---------------------------------------------------------------------------
grant select on public.teams to authenticated;
grant insert (department_id, name, division) on public.teams to authenticated;
grant update (name, division) on public.teams to authenticated;
grant delete on public.teams to authenticated;

create policy teams_select on public.teams for select to authenticated
  using ((select private.is_super_admin()) or department_id = (select private.my_department_id()));
create policy teams_insert on public.teams for insert to authenticated
  with check ((select private.is_super_admin())
              or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id())));
create policy teams_update on public.teams for update to authenticated
  using ((select private.is_super_admin())
         or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id())))
  with check ((select private.is_super_admin())
              or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id())));
create policy teams_delete on public.teams for delete to authenticated
  using ((select private.is_super_admin())
         or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id())));

-- ---------------------------------------------------------------------------
-- profiles: read by hierarchy; users may edit only their own contact fields.
-- No INSERT/DELETE grants (sign-up trigger / delete_user function).
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, phone, position) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (private.can_view_profile(id, role, department_id, team_id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select private.my_id())) with check (id = (select private.my_id()));

-- ---------------------------------------------------------------------------
-- customers
--   read/update: Super Admin all | dept head own dept | team head own team |
--                team member own customers
--   insert: any active user, ownership validated by trigger + check below
--   delete: team head and above, within scope
-- ---------------------------------------------------------------------------
grant select on public.customers to authenticated;
grant insert (owner_id, name, email, phone, company, segment, status, notes,
              last_order_date, last_order_amount, total_spent, order_count) on public.customers to authenticated;
grant update (owner_id, name, email, phone, company, segment, status, notes,
              last_order_date, last_order_amount, total_spent, order_count) on public.customers to authenticated;
grant delete on public.customers to authenticated;

create policy customers_select on public.customers for select to authenticated
  using (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id()))
    or ((select private.my_role()) = 'TEAM_MEMBER' and owner_id = (select private.my_id()))
  );
create policy customers_insert on public.customers for insert to authenticated
  with check (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id()))
    or ((select private.my_role()) = 'TEAM_MEMBER' and owner_id = (select private.my_id()))
  );
create policy customers_update on public.customers for update to authenticated
  using (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id()))
    or ((select private.my_role()) = 'TEAM_MEMBER' and owner_id = (select private.my_id()))
  )
  with check (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id()))
    or ((select private.my_role()) = 'TEAM_MEMBER' and owner_id = (select private.my_id()))
  );
create policy customers_delete on public.customers for delete to authenticated
  using (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id()))
  );

-- ---------------------------------------------------------------------------
-- customer_activities: inherit customer visibility (the subquery is itself
-- subject to the customers policies). Immutable once written.
-- ---------------------------------------------------------------------------
grant select on public.customer_activities to authenticated;
grant insert (customer_id, type, note, occurred_at) on public.customer_activities to authenticated;

create policy customer_activities_select on public.customer_activities for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));
create policy customer_activities_insert on public.customer_activities for insert to authenticated
  with check ((select private.my_id()) is not null
              and exists (select 1 from public.customers c where c.id = customer_id));

-- ---------------------------------------------------------------------------
-- approval_requests: subject sees own; managers see those they may decide.
-- Writes only through approve_registration / reject_registration.
-- ---------------------------------------------------------------------------
grant select on public.approval_requests to authenticated;

create policy approval_requests_select on public.approval_requests for select to authenticated
  using (subject_user_id = auth.uid() or private.can_manage_profile(subject_user_id));

-- ---------------------------------------------------------------------------
-- notifications: recipient only (active), may mark read or delete.
-- ---------------------------------------------------------------------------
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select private.my_id()));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = (select private.my_id())) with check (recipient_id = (select private.my_id()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (recipient_id = (select private.my_id()));

-- ---------------------------------------------------------------------------
-- audit_logs: read-only, hierarchical. Nobody (but the DB owner) can write,
-- update or delete through the API.
-- ---------------------------------------------------------------------------
grant select on public.audit_logs to authenticated;

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id()))
  );

revoke insert, update, delete, truncate on public.audit_logs from service_role;

-- ---------------------------------------------------------------------------
-- crm_settings: read by active users, written by Super Admin
-- ---------------------------------------------------------------------------
grant select on public.crm_settings to authenticated;
grant insert (key, value, description) on public.crm_settings to authenticated;
grant update (value, description) on public.crm_settings to authenticated;
grant delete on public.crm_settings to authenticated;

create policy crm_settings_select on public.crm_settings for select to authenticated
  using ((select private.my_id()) is not null);
create policy crm_settings_write on public.crm_settings for all to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create or replace function private.tg_crm_settings_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := (select id from public.profiles where id = auth.uid());
  return new;
end $$;
create trigger crm_settings_before_write before insert or update on public.crm_settings
  for each row execute function private.tg_crm_settings_before_write();

-- ---------------------------------------------------------------------------
-- Functions in `private` are never callable by anonymous users.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon;
alter default privileges in schema private revoke execute on functions from public;
