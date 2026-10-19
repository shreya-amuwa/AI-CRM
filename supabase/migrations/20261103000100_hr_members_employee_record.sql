-- HR members get their HR employee record at once.
--
-- A login created in the HR department (Department Head, Team Lead or Team Member, from the Super Admin's Add Member form, the
-- API or `npm run create:hr-login`) is linked to its HR employee record (public.hr_employees.profile_id) when the account is
-- created, so the HR dashboard's directory, salary, documents and leave all hang off one record per person. Until now that row
-- appeared only the first time HR edited the person.
--
--  * The record id is the same one the HR directory shows for an account without a record (EMP- + the first 8 characters of the
--    account id), so nothing is listed twice. An existing record (matched by account or by id) is never changed.
--  * It also covers a member moved into the HR department later.
--  * Existing HR members without a record get one now. Nothing is deleted or overwritten.
-- Idempotent.

create or replace function private.link_hr_employee_record(p_profile uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.hr_employees (id, name, email, designation, department_id, status, joining_date, profile_id)
  select 'EMP-' || upper(left(p.id::text, 8)), p.full_name, p.email,
         coalesce(nullif(btrim(p.position), ''), case p.role when 'DEPARTMENT_HEAD' then 'Department Head' when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end),
         'hr', 'Full-Time', to_char(coalesce(p.approved_at, p.created_at), 'YYYY-MM-DD'), p.id
    from public.profiles p join public.departments d on d.id = p.department_id
   where p.id = p_profile and d.slug = 'hr' and p.role <> 'SUPER_ADMIN'
  on conflict do nothing;
end $$;
revoke all on function private.link_hr_employee_record(uuid) from public, anon, authenticated;

create or replace function private.tg_link_hr_employee_record()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.link_hr_employee_record(new.id);
  return new;
end $$;
revoke all on function private.tg_link_hr_employee_record() from public, anon, authenticated;

drop trigger if exists profiles_link_hr_employee_record on public.profiles;
create trigger profiles_link_hr_employee_record after insert or update of department_id on public.profiles
  for each row when (new.department_id is not null) execute function private.tg_link_hr_employee_record();

-- members already in the HR department
do $$
declare
  r record;
begin
  for r in select p.id from public.profiles p join public.departments d on d.id = p.department_id
            where d.slug = 'hr' and p.role <> 'SUPER_ADMIN' loop
    perform private.link_hr_employee_record(r.id);
  end loop;
end $$;
