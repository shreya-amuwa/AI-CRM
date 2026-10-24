-- Repair for databases that ran the first version of reset_all_data_keep_super_admin.sql.
-- Symptom: creating a user fails with "Could not create the user account" (HTTP 500); the cause is
--   duplicate key value violates unique constraint "audit_logs_pkey"
-- because the audit log was kept but its numbering was reset to 1. Run this ONCE in the Supabase SQL editor (safe to run again, deletes nothing):
select setval(pg_get_serial_sequence('public.audit_logs', 'id'), coalesce((select max(id) from public.audit_logs), 0) + 1, false);
