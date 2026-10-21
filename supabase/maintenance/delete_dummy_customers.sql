-- =============================================================================
-- Delete dummy / test customers and everything that belongs to them.
--
-- Run it in the Supabase SQL editor. It is SAFE BY DEFAULT: with the confirmation left empty it only
-- shows what WOULD be deleted. Nothing is deleted until you type the confirmation phrase in step 1.
-- It runs as one statement, so it either deletes everything or nothing.
--
-- What is removed for every selected customer (lead, potential, onboarding or customer record):
--   * the customer, its services, onboarding checklist and entries, notes, conversations, activity log
--   * uploaded documents and invoice records (the files in Storage: see scripts/sweep-orphan-customer-files.mjs)
--   * payments, payment requests, follow-ups, add-on requests and add-on payments
--   * invoices of the customer, work tasks about the customer, support tickets, invoice requests
--   * automation messages (emails / WhatsApp log) and the client's app login (auth user)
--   * the bell notifications and audit log rows about those records (switch off in step 1)
-- NOT removed: staff, teams, departments, expenses, and customers you keep.
--
-- Finance totals (Account Dashboard) are calculated from the payments, so they drop with the data.
-- Take a backup first (Supabase: Database > Backups) if there is any chance a real customer is included.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1. Settings (edit this line only)
--   confirm              : type DELETE DUMMY CUSTOMERS to really delete. Empty = preview only.
--   purge_history        : also remove audit-log and bell-notification rows about these records.
--   reset_invoice_numbers: when no invoice is left, start INV-YYYY-00001 again.
-- ---------------------------------------------------------------------------
drop table if exists pg_temp.cleanup_settings;
create temp table cleanup_settings as
select ''::text as confirm,
       true     as purge_history,
       false    as reset_invoice_numbers;

-- ---------------------------------------------------------------------------
-- STEP 2. Who is deleted (edit if you want to KEEP some customers)
--   Default: EVERY customer / lead record. To keep real ones, uncomment and edit a line below.
-- ---------------------------------------------------------------------------
drop table if exists pg_temp.doomed;
create temp table doomed as
select c.id
  from public.customers c
 where true
   -- and c.email is distinct from 'real.customer@example.com'
   -- and c.company not in ('Real Company Pvt Ltd')
   -- and c.id not in ('00000000-0000-0000-0000-000000000000')
   -- and c.created_at >= '2026-10-01'           -- delete only records created on/after this date
;

-- ---------------------------------------------------------------------------
-- STEP 3. Count (and, when confirmed, delete). Do not edit.
-- ---------------------------------------------------------------------------
drop table if exists pg_temp.cleanup_report;
create temp table cleanup_report (sort int, what text, amount bigint);

do $$
declare
  s record;
  t text;
  v_confirmed boolean;
  v_n bigint;
  v_i int := 0;
  -- tables that hold a customer_id (deleted with the customer, or before it where the link is "restrict")
  v_tables text[] := array[
    'customers', 'customer_services', 'customer_onboarding', 'customer_onboarding_entries', 'customer_documents',
    'customer_activities', 'consultant_notes', 'lead_conversations', 'customer_payments', 'payment_requests',
    'payment_followups', 'addon_requests', 'addon_payments', 'support_tickets', 'invoice_requests',
    'onboarding_automation_runs', 'automation_jobs', 'customer_client_accounts', 'work_tasks', 'member_invoices'];
begin
  select * into s from pg_temp.cleanup_settings;
  v_confirmed := s.confirm = 'DELETE DUMMY CUSTOMERS';
  if s.confirm <> '' and not v_confirmed then
    raise exception 'The confirmation must be exactly: DELETE DUMMY CUSTOMERS (nothing was deleted).';
  end if;

  -- what is selected
  foreach t in array v_tables loop
    v_i := v_i + 1;
    if t = 'customers' then
      select count(*) into v_n from pg_temp.doomed;
    else
      execute format('select count(*) from public.%I where customer_id in (select id from pg_temp.doomed)', t) into v_n;
    end if;
    insert into pg_temp.cleanup_report values (v_i, t, v_n);
  end loop;
  insert into pg_temp.cleanup_report values (100, 'customers that stay', (select count(*) from public.customers where id not in (select id from pg_temp.doomed)));
  insert into pg_temp.cleanup_report values (101, 'client app logins (auth users)', (select count(*) from public.customer_client_accounts a where a.customer_id in (select id from pg_temp.doomed)));

  -- ids needed after the rows are gone
  create temp table _d_auth on commit drop as
    select a.auth_user_id as id from public.customer_client_accounts a where a.customer_id in (select id from pg_temp.doomed) and a.auth_user_id is not null;
  create temp table _d_ids on commit drop as
    select id, 'customer' as kind from pg_temp.doomed
    union all select id, 'invoice' from public.member_invoices where customer_id in (select id from pg_temp.doomed)
    union all select id, 'document' from public.customer_documents where customer_id in (select id from pg_temp.doomed)
    union all select id, 'payment' from public.customer_payments where customer_id in (select id from pg_temp.doomed)
    union all select id, 'addon' from public.addon_requests where customer_id in (select id from pg_temp.doomed);

  insert into pg_temp.cleanup_report values (102, 'bell notifications about them (removed with "purge_history")', (select count(*) from public.notifications where entity_id in (select id from _d_ids)));
  insert into pg_temp.cleanup_report values (103, 'audit-log rows about them (removed with "purge_history")',
    (select count(*) from public.audit_logs where entity_id in (select id from _d_ids) or (metadata ->> 'customer_id') in (select id::text from pg_temp.doomed)));

  if not v_confirmed then
    insert into pg_temp.cleanup_report values (999, 'PREVIEW ONLY - nothing was deleted. Type the confirmation in step 1 to delete.', 0);
    return;
  end if;

  -- 1. rows that block the customer from being deleted ("restrict" links), in dependency order
  delete from public.customer_payments  where customer_id in (select id from pg_temp.doomed);
  delete from public.payment_followups  where customer_id in (select id from pg_temp.doomed);
  delete from public.payment_requests   where customer_id in (select id from pg_temp.doomed);
  delete from public.addon_payments     where customer_id in (select id from pg_temp.doomed);
  delete from public.customer_documents where customer_id in (select id from pg_temp.doomed);
  delete from public.addon_requests     where customer_id in (select id from pg_temp.doomed);
  delete from public.member_invoices    where customer_id in (select id from pg_temp.doomed);
  delete from public.work_tasks         where customer_id in (select id from pg_temp.doomed);

  -- 2. the customers (everything else linked with "cascade" goes with them)
  delete from public.customers where id in (select id from pg_temp.doomed);

  -- 3. the client's app login
  delete from auth.users where id in (select id from _d_auth);

  -- 4. history about these records
  if s.purge_history then
    delete from public.notifications where entity_id in (select id from _d_ids);
    -- audit rows are append-only; this deliberate clean-up of test records says so (for this transaction only)
    perform set_config('amuwa.audit_purge', 'on', true);
    delete from public.audit_logs
     where entity_id in (select id from _d_ids)
        or (metadata ->> 'customer_id') in (select id::text from pg_temp.doomed);
  end if;

  -- 5. optional: numbering starts again when no invoice is left
  if s.reset_invoice_numbers and not exists (select 1 from public.member_invoices where kind <> 'MANUAL') then
    perform setval('public.invoice_number_seq', 1, false);
  end if;

  insert into pg_temp.cleanup_report values (999, 'DELETED. Now remove the uploaded files from Storage (scripts/sweep-orphan-customer-files.mjs).', 0);
end $$;

-- ---------------------------------------------------------------------------
-- Result (what was counted / deleted)
-- ---------------------------------------------------------------------------
select what, amount from pg_temp.cleanup_report order by sort;
