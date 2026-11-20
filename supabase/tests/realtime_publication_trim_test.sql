-- =============================================================================
-- Realtime publication trim (migration 20270116000200): the 6 tables no screen listens to leave supabase_realtime; every table a screen listens
-- to stays (the list below is every postgres_changes / listenToTables / useRealtime table in src/). Safe to run twice.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 170. Realtime publication: only the tables the screens listen to'
reset role;
create temp table rt_listened (t text primary key);
insert into rt_listened values
  ('approval_requests'), ('profiles'), ('hr_employees'), ('member_follow_ups'), ('member_activities'), ('member_deals'), ('member_calendar_events'),
  ('member_eod_reports'), ('member_invoices'), ('customers'), ('field_visits'), ('chat_conversations'), ('chat_members'), ('chat_messages'),
  ('client_notifications'), ('crm_leads'), ('notifications'), ('customer_documents'), ('customer_onboarding'), ('customer_onboarding_entries'),
  ('work_tasks'), ('work_task_updates'), ('work_report_signals'), ('lead_visit_locations'), ('lead_visits'), ('field_visit_lead_routes'),
  ('lead_visit_assignments'), ('automation_jobs'), ('invoice_requests'), ('support_ticket_reads'), ('support_ticket_updates'), ('support_tickets'),
  ('tc_followups'), ('meeting_presence');
create temp table rt_before as select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
-- the unused ones published again (as the older migrations left them), to see them go
do $$
declare t text;
begin
  foreach t in array array['hr_attendance', 'hr_leave_applications', 'team_assignments', 'department_operations_owner', 'onboarding_automation_runs', 'support_ticket_escalations'] loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
\i supabase/migrations/20270116000200_realtime_publication_trim.sql
\i supabase/migrations/20270116000200_realtime_publication_trim.sql
select test.check((select count(*) = 0 from pg_publication_tables where pubname = 'supabase_realtime'
                     and tablename in ('hr_attendance', 'hr_leave_applications', 'team_assignments', 'department_operations_owner', 'onboarding_automation_runs', 'support_ticket_escalations')),
  'the 6 tables no screen listens to are no longer published (and a second run changes nothing)');
select test.check((select count(*) = 0 from rt_before b join rt_listened l on l.t = b.tablename
                    where not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.tablename = b.tablename)),
  'every published table a screen listens to is still published');
select test.check((select count(*) >= 20 from pg_publication_tables p join rt_listened l on l.t = p.tablename where p.pubname = 'supabase_realtime'),
  'the live screens (chat, notifications, leads, customers, tasks, tickets ...) keep their live updates');
\echo '=== ALL REALTIME PUBLICATION TESTS PASSED ==='
