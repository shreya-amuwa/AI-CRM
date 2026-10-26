-- =============================================================================
-- Query performance: faster Row Level Security checks and indexes for the foreign keys the app filters, joins and cascades on.
-- No data, permission or behaviour change. Additive / idempotent: safe to run again.
--
--  1. RLS: a per-user function in a policy (private.my_id(), private.my_role(), auth.uid(), ...) written bare is evaluated for EVERY row;
--     wrapped as (select private.my_id()) Postgres evaluates it ONCE per query (an "initPlan"). The result is identical: these functions
--     take no arguments and are STABLE, so they return the same value for every row of one statement. Only zero-argument STABLE/IMMUTABLE
--     functions of the private and auth schemas are wrapped; functions that take a row value (e.g. private.can_manage_profile(id)) are
--     left exactly as they are. Policies already written this way are untouched.
--  2. Indexes on foreign keys that are used to look rows up (per customer, per person, per department / team) or that a delete of the
--     parent has to scan. Audit-only columns (created_by, reviewed_by, ...) are deliberately not indexed: that would only slow writes.
-- =============================================================================

-- 1. RLS initPlan --------------------------------------------------------------------------------------------------------------------
do $$
declare
  pol record;
  v_qual text;
  v_check text;
  v_sql text;
  -- a bare call (not already "SELECT f()") of a zero-argument function of the private / auth schema
  c_rx constant text := '(?<!SELECT )\m((private|auth)\.([a-z_][a-z0-9_]*))\(\)';
begin
  for pol in
    select p.schemaname, p.tablename, p.policyname, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public'
       and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ c_rx
  loop
    v_qual := pol.qual;
    v_check := pol.with_check;
    -- every bare call in this policy must be a zero-argument STABLE/IMMUTABLE function; otherwise the policy is left alone
    if exists (
      select 1
        from regexp_matches(coalesce(v_qual, '') || ' ' || coalesce(v_check, ''), c_rx, 'g') m
       where not exists (
         select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
          where n.nspname = m[2] and f.proname = m[3] and f.pronargs = 0 and f.provolatile in ('s', 'i'))
    ) then
      raise notice 'RLS initPlan: % on %.% left as it is (a function is not a zero-argument stable one)', pol.policyname, pol.schemaname, pol.tablename;
      continue;
    end if;
    v_sql := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    if v_qual is not null then
      v_sql := v_sql || format(' using (%s)', regexp_replace(v_qual, c_rx, '(select \1())', 'g'));
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', regexp_replace(v_check, c_rx, '(select \1())', 'g'));
    end if;
    execute v_sql;
  end loop;
end $$;

-- 2. Foreign-key indexes -------------------------------------------------------------------------------------------------------------
-- per customer (and a customer delete cascades through these)
create index if not exists addon_payments_customer_idx on public.addon_payments (customer_id);
create index if not exists invoice_payments_customer_idx on public.invoice_payments (customer_id);
create index if not exists client_announcement_dismissals_customer_idx on public.client_announcement_dismissals (customer_id);
create index if not exists support_ticket_attachments_customer_idx on public.support_ticket_attachments (customer_id);
create index if not exists crm_leads_converted_customer_idx on public.crm_leads (converted_customer_id);
-- per person
create index if not exists hr_email_events_profile_idx on public.hr_email_events (profile_id);
create index if not exists hr_probation_cycles_profile_idx on public.hr_probation_cycles (profile_id);
create index if not exists hr_training_enrollments_profile_idx on public.hr_training_enrollments (profile_id);
create index if not exists hr_training_programs_owner_idx on public.hr_training_programs (owner_id);
create index if not exists hr_training_days_trainer_idx on public.hr_training_days (trainer_id);
create index if not exists hr_candidate_actions_assignee_idx on public.hr_candidate_actions (assignee_id);
create index if not exists support_ticket_reads_profile_idx on public.support_ticket_reads (profile_id);
create index if not exists support_ticket_updates_assignee_idx on public.support_ticket_updates (assignee_id);
create index if not exists support_ticket_escalations_to_user_idx on public.support_ticket_escalations (to_user);
create index if not exists performance_reports_subject_idx on public.performance_reports (subject_id);
create index if not exists invoice_business_tags_responsible_idx on public.invoice_business_tags (responsible_id);
create index if not exists ba_contacts_telecaller_idx on public.ba_contacts (telecaller_id);
-- per department / team (the scope every head and lead reads by)
create index if not exists ba_contacts_department_idx on public.ba_contacts (department_id);
create index if not exists leave_requests_department_idx on public.leave_requests (department_id);
create index if not exists member_invoices_department_idx on public.member_invoices (department_id);
create index if not exists telecaller_contacts_department_idx on public.telecaller_contacts (department_id);
create index if not exists telecaller_contact_lists_department_idx on public.telecaller_contact_lists (department_id);
create index if not exists addon_requests_department_idx on public.addon_requests (department_id);
create index if not exists revenue_attributions_department_idx on public.revenue_attributions (department_id);
create index if not exists customers_acquisition_department_idx on public.customers (acquisition_department_id);
create index if not exists work_tasks_team_idx on public.work_tasks (team_id);
create index if not exists performance_reports_team_idx on public.performance_reports (team_id);
-- parent -> child links
create index if not exists customer_payments_request_idx on public.customer_payments (request_id);
create index if not exists service_requests_addon_request_idx on public.service_requests (addon_request_id);
create index if not exists addon_requests_invoice_idx on public.addon_requests (invoice_id);
create index if not exists sales_lead_sheets_telecaller_list_idx on public.sales_lead_sheets (telecaller_list_id);
create index if not exists chat_messages_reply_to_idx on public.chat_messages (reply_to);
create index if not exists customer_onboarding_entries_document_idx on public.customer_onboarding_entries (document_id);
create index if not exists invoice_business_tags_invoice_request_idx on public.invoice_business_tags (invoice_request_id);

-- fresh statistics for the planner
analyze public.customers, public.ba_contacts, public.work_tasks, public.performance_reports, public.support_tickets, public.profiles;
