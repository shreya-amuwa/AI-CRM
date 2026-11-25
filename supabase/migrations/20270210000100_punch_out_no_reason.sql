-- =============================================================================
-- Punch Out before the shift end needs no reason (owner's decision, 2026-11-25). The Punch Out dialog only asks
-- "End your workday?" and Confirm Punch Out; it no longer shows an early-leave warning or asks why.
--
-- Changes only a setting (follows 20270205000200_team_attendance_corrections.sql): the company switch
-- attendance_settings.early_punch_out_reason_required is turned off and its default becomes off.
-- attendance_punch_out_confirmed keeps accepting an optional reason; HR can switch the rule back on later without code.
-- The app already punches out through attendance_punch_out (no reason), so it works before and after this is run.
-- Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

alter table public.attendance_settings add column if not exists early_punch_out_reason_required boolean not null default false;
alter table public.attendance_settings alter column early_punch_out_reason_required set default false;
update public.attendance_settings set early_punch_out_reason_required = false where early_punch_out_reason_required;

notify pgrst, 'reload schema';
