-- =============================================================================
-- Supabase Realtime: stop publishing the tables no screen listens to. Run after 20270115000500_crocodial_sync_now_minute.sql (and after
-- 20270116000100_meeting_live_availability.sql when that is merged). Safe to run twice. No row, table, column or policy changes.
--
-- WHY. On 19 Nov 2026 the database ran out of CPU (logins and attendance timing out, "could not reach Supabase: TimeoutError" in the Worker).
-- 56% of all database time was Supabase Realtime reading the change log and working through every change of every table in the
-- supabase_realtime publication. 40 tables were published; the screens listen (postgres_changes, listenToTables, useRealtime) to 34 of them.
-- These 6 are written to but never listened to, so every change to them was work for nobody:
--   hr_attendance, hr_leave_applications, team_assignments, department_operations_owner, onboarding_automation_runs, support_ticket_escalations
-- Checked against every listener in src/ (and meeting_presence, which the CEO availability screen of the meeting work listens to, is kept).
-- Nothing on screen changes: those pages reload on their own actions, as before. To publish one again later:
--   alter publication supabase_realtime add table public.<name>;
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['hr_attendance', 'hr_leave_applications', 'team_assignments', 'department_operations_owner',
                           'onboarding_automation_runs', 'support_ticket_escalations'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;
