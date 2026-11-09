-- =============================================================================
-- Migration readiness check (READ ONLY: it only reads the catalog, changes nothing, safe on production).
-- Paste the whole file into the Supabase SQL editor. Every row says whether a database object that a screen needs exists.
--   ok = false  ->  run the migration named in "run_migration" (the whole file, once; every migration is safe to run again).
-- Why: the CRM shows "This feature needs a database update that has not been applied yet" when ANY function or table a screen calls is missing;
-- the message does not say which one. This lists the key objects of the recent migrations, so the missing migration can be named.
-- It does not read the migration history table: migrations pasted by hand are not recorded there, so the real objects are checked instead.
-- =============================================================================
with checks (feature, object, run_migration, ok) as (
  values
  ('Add New Lead: plan, duration and amount of each service', 'function set_subscription_terms', '20261210000200_subscription_activation.sql', to_regprocedure('public.set_subscription_terms(uuid,text,jsonb)') is not null),
  ('Subscriptions: activation, expiry, renewal', 'table subscription_cycles', '20261210000200_subscription_activation.sql', to_regclass('public.subscription_cycles') is not null),
  ('Subscriptions: history', 'table subscription_history', '20261210000200_subscription_activation.sql', to_regclass('public.subscription_history') is not null),
  ('Subscriptions: duration stored per service', 'column customer_services.duration_code', '20261210000200_subscription_activation.sql',
     exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_services' and column_name = 'duration_code')),
  ('Subscriptions: activation confirmation', 'function confirm_subscription_activation', '20261210000200_subscription_activation.sql', to_regprocedure('public.confirm_subscription_activation(uuid,text,date,date,text)') is not null),
  ('Sales / Business Associate: Subscriptions list', 'function subscriptions_list', '20261212000100_sales_subscriptions_list.sql', to_regprocedure('public.subscriptions_list(text,text,integer,integer)') is not null),
  ('Employee approval hierarchy', 'function employee_request_decide', '20261211000100_employee_approval_hierarchy.sql', to_regprocedure('public.employee_request_decide(uuid,boolean,text,uuid[],uuid[])') is not null),
  ('Work reports', 'table work_reports', '20261213000100_work_reports.sql', to_regclass('public.work_reports') is not null),
  ('Work reports: two-level approval', 'column work_reports.tl_status', '20261217000100_reports_two_level_approval.sql',
     exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'work_reports' and column_name = 'tl_status')),
  ('Operations Head creation', 'table operations_head_departments', '20261218000100_operations_head_creation.sql', to_regclass('public.operations_head_departments') is not null),
  ('Employee welcome e-mail', 'table employee_welcome_emails', '20261219000100_employee_welcome_email.sql', to_regclass('public.employee_welcome_emails') is not null)
)
select ok, feature, object, run_migration from checks order by ok, run_migration, feature;
