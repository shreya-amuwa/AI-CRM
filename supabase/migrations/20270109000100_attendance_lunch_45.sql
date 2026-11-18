-- =============================================================================
-- Attendance: the lunch allowance becomes 45 minutes (was 50, migration 20261230000400).
-- Safe to run twice. An allowance HR has already changed to something other than 50 is kept.
-- =============================================================================

alter table public.attendance_settings alter column lunch_allowance_minutes set default 45;

update public.attendance_settings
   set lunch_allowance_minutes = 45, updated_at = now()
 where id and lunch_allowance_minutes = 50;

create or replace function private.lunch_allowance()
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select lunch_allowance_minutes from public.attendance_settings where id), 45)
$$;
revoke all on function private.lunch_allowance() from public, anon, authenticated;
