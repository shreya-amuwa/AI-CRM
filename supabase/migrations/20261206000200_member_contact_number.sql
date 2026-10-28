-- =============================================================================
-- The team member's OWN contact number, separate from the emergency contact number.
--
--   employee_personal_details.contact_number   the member's own number, stored normalised with its country code ('+919876543210').
--   employee_personal_details.emergency_contact stays as it was (never overwritten by the number above).
--
-- Both are private: this table is readable only through hr_personal_details() (HR staff and the Super Admin) and my_personal_details()
-- (the person themselves). The number is NOT copied to profiles.phone, which every colleague who can see the profile can read.
-- Existing members have no contact number yet (null); nothing is guessed or copied from the emergency contact.
-- hr_update_member_contacts() lets HR staff / the Super Admin set or correct the two numbers of one member without touching anything else.
-- Additive and safe to run again.
-- =============================================================================
alter table public.employee_personal_details add column if not exists contact_number text;
alter table public.employee_personal_details drop constraint if exists employee_personal_details_contact_number_check;
alter table public.employee_personal_details add constraint employee_personal_details_contact_number_check
  check (contact_number is null or contact_number ~ '^\+[1-9][0-9]{7,14}$');

create or replace function public.hr_personal_details()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can view employee personal details.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'profileId', d.profile_id, 'designation', d.designation, 'joiningDate', d.joining_date,
      'dateOfBirth', d.date_of_birth, 'bloodGroup', d.blood_group, 'emergencyContact', d.emergency_contact,
      'contactNumber', d.contact_number))
    from public.employee_personal_details d), '[]'::jsonb);
end $$;

create or replace function public.my_personal_details()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
      'profileId', d.profile_id, 'designation', d.designation, 'joiningDate', d.joining_date,
      'dateOfBirth', d.date_of_birth, 'bloodGroup', d.blood_group, 'emergencyContact', d.emergency_contact,
      'contactNumber', d.contact_number)
    from public.employee_personal_details d where d.profile_id = auth.uid()), 'null'::jsonb)
$$;

-- Set or correct the two numbers of one member. A null leaves that number as it is; an empty string is refused (a number is never cleared by accident).
create or replace function public.hr_update_member_contacts(p_profile uuid, p_contact text default null, p_emergency text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
  v_emergency text := nullif(btrim(coalesce(p_emergency, '')), '');
  v_row public.employee_personal_details;
begin
  if not (private.is_hr_staff() or exists (select 1 from public.profiles m where m.id = auth.uid() and m.status = 'ACTIVE' and m.role = 'SUPER_ADMIN')) then
    raise exception 'FORBIDDEN: Only HR staff and the Super Admin can change employee contact numbers.' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001'; end if;
  if p_contact is not null and v_contact is null or p_emergency is not null and v_emergency is null then
    raise exception 'VALIDATION_ERROR: A contact number cannot be cleared; enter the correct number.' using errcode = 'P0001';
  end if;
  if v_contact is not null and v_contact !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'VALIDATION_ERROR: Enter the contact number with its country code, for example +919876543210.' using errcode = 'P0001';
  end if;
  if v_emergency is not null and (v_emergency !~ '^\+?[0-9 ()-]{7,20}$' or length(regexp_replace(v_emergency, '\D', '', 'g')) not between 10 and 15) then
    raise exception 'VALIDATION_ERROR: Enter a valid emergency contact number (10 to 15 digits).' using errcode = 'P0001';
  end if;
  insert into public.employee_personal_details (profile_id) values (p_profile) on conflict (profile_id) do nothing;
  update public.employee_personal_details
     set contact_number = coalesce(v_contact, contact_number), emergency_contact = coalesce(v_emergency, emergency_contact), updated_at = now()
   where profile_id = p_profile returning * into v_row;
  if v_row.contact_number is not null and v_row.emergency_contact is not null
     and right(regexp_replace(v_row.contact_number, '\D', '', 'g'), 10) = right(regexp_replace(v_row.emergency_contact, '\D', '', 'g'), 10) then
    raise exception 'VALIDATION_ERROR: The emergency contact must be a different number from the member''s own number.' using errcode = 'P0001';
  end if;
  perform private.write_audit('EMPLOYEE_CONTACTS_UPDATED', 'profile', t.id, t.department_id, t.team_id,
    jsonb_build_object('contact_changed', v_contact is not null, 'emergency_changed', v_emergency is not null));
  return jsonb_build_object('profileId', v_row.profile_id, 'contactNumber', v_row.contact_number, 'emergencyContact', v_row.emergency_contact);
end $$;
revoke all on function public.hr_update_member_contacts(uuid, text, text) from public, anon;
grant execute on function public.hr_update_member_contacts(uuid, text, text) to authenticated;
