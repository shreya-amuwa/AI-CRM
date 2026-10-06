-- =============================================================================
-- Replace the world-readable/writable `USING (true)` policies on legacy tables.
--   crm_leads, blueprint_requirements: any ACTIVE CRM user (lead routing is
--     still department-string based; scoped in the leads migration phase).
--   hr_employees, hr_attendance, hr_leave_applications: Super Admin + HR dept.
-- Inbound webhooks write with the service-role key (bypasses RLS).
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('crm_leads', 'blueprint_requirements', 'hr_employees', 'hr_attendance', 'hr_leave_applications')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

revoke all on public.crm_leads, public.blueprint_requirements, public.hr_employees,
  public.hr_attendance, public.hr_leave_applications from anon;
revoke all on public.crm_leads, public.blueprint_requirements, public.hr_employees,
  public.hr_attendance, public.hr_leave_applications from authenticated;
grant select, insert, update, delete on public.crm_leads, public.blueprint_requirements, public.hr_employees,
  public.hr_attendance, public.hr_leave_applications to authenticated;

create policy crm_leads_active_users on public.crm_leads for all to authenticated
  using ((select private.my_id()) is not null) with check ((select private.my_id()) is not null);
create policy blueprint_requirements_active_users on public.blueprint_requirements for all to authenticated
  using ((select private.my_id()) is not null) with check ((select private.my_id()) is not null);

create policy hr_employees_hr_staff on public.hr_employees for all to authenticated
  using ((select private.is_hr_staff())) with check ((select private.is_hr_staff()));
create policy hr_attendance_hr_staff on public.hr_attendance for all to authenticated
  using ((select private.is_hr_staff())) with check ((select private.is_hr_staff()));
create policy hr_leave_applications_hr_staff on public.hr_leave_applications for all to authenticated
  using ((select private.is_hr_staff())) with check ((select private.is_hr_staff()));
