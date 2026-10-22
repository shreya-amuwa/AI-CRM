-- =============================================================================
-- The security migrations, in order (with the Super Admin dashboard migration that the security events one is written to follow).
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Every part is idempotent (safe to run again); no data is deleted.
--   1. 20261106000100_security_hardening.sql   scoped leads, private storage buckets, least privilege, scrubbed audit trail, sign-in lockout
--   2. 20261110000100_dashboards_overview.sql  the company / department dashboards (the security events migration is written to run after it)
--   3. 20261110000200_security_events.sql      security and audit events: outcome, request id, append-only audit log, server events, audit viewer
-- Needs the earlier migrations to be applied already, in particular the chat migration 20261108000100_chat.sql
-- (the security events migration audits chat group membership).
-- Run it BEFORE run_these_8_migrations_tickets_to_payment_gst.sql (that file needs everything up to 20261110000200).
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261106000100_security_hardening.sql
-- =============================================================================
-- Security hardening (additive, safe to rerun in the Supabase SQL editor; no data is deleted or changed)
--
--  1. Leads (crm_leads) and blueprint requests were readable and writable by ANY active staff member of ANY department.
--     They are now scoped: Super Admin, the Amuwa Corporation (HQ) department, the lead's own department, or the member
--     the lead is assigned to.
--  2. The two legacy storage buckets were PUBLIC (anyone with a link could read the files). They become private.
--  3. Least privilege: nobody signed-out (anon) holds table privileges; nobody holds TRUNCATE / REFERENCES / TRIGGER on
--     CRM tables; functions are no longer executable by signed-out visitors except the sign-up options list.
--  4. Audit trail: record_security_event() (server only) for webhook / sign-in events, and audit metadata is scrubbed so a
--     password, token or secret can never be written to the audit log.
--  5. Sign-in protection: failed sign-ins are counted per account; 5 failures in 15 minutes lock the account for the rest
--     of the window and are audited (LOGIN_FAILED / LOGIN_LOCKED). It is a Supabase Auth "password verification" hook:
--     enable it once in the dashboard (Authentication > Hooks), see docs/SECURITY.md. Harmless until enabled.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Department-scoped leads and requirements
-- ---------------------------------------------------------------------------
create or replace function private.my_department_slug()
returns text language sql stable security definer set search_path = '' as $$
  select d.slug from public.profiles p join public.departments d on d.id = p.department_id
   where p.id = auth.uid() and p.status = 'ACTIVE'
$$;
revoke all on function private.my_department_slug() from public, anon;
grant execute on function private.my_department_slug() to authenticated, service_role;

-- Can the signed-in user see / change a row that belongs to this department (a slug)?
create or replace function private.can_use_department_slug(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.my_id()) is not null and (
    (select private.is_super_admin())
    or (select private.my_department_slug()) = 'amuwa'           -- Amuwa Corporation (head office) sees all units
    or p_slug is not distinct from (select private.my_department_slug())
  )
$$;
revoke all on function private.can_use_department_slug(text) from public, anon;
grant execute on function private.can_use_department_slug(text) to authenticated, service_role;

drop policy if exists crm_leads_active_users on public.crm_leads;
drop policy if exists crm_leads_department_scope on public.crm_leads;
create policy crm_leads_department_scope on public.crm_leads for all to authenticated
  using (private.can_use_department_slug(department) or assigned_to = (select private.my_id()))
  with check (private.can_use_department_slug(department) or assigned_to = (select private.my_id()));

drop policy if exists blueprint_requirements_active_users on public.blueprint_requirements;
drop policy if exists blueprint_requirements_department_scope on public.blueprint_requirements;
create policy blueprint_requirements_department_scope on public.blueprint_requirements for all to authenticated
  using (private.can_use_department_slug(department_id))
  with check (private.can_use_department_slug(department_id));

-- ---------------------------------------------------------------------------
-- 2. Legacy storage buckets: private (the objects stay where they are; nothing in the app links to them)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set public = false where id in ('blueprint-files', 'amuwa-docs') and public;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Least privilege
-- ---------------------------------------------------------------------------
-- Signed-out visitors need no table at all (sign-up options come from a function).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- Signed-in users never need TRUNCATE (it ignores Row Level Security), REFERENCES or TRIGGER.
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Reference tables the app only reads.
revoke insert, update, delete on public.onboarding_items, public.onboarding_item_services,
  public.customer_onboarding_entries, public.onboarding_automation_runs from authenticated;

-- Functions: only list_registration_options() is meant for signed-out visitors.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'list_registration_options'
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
-- New tables / functions of this project do not start with signed-out access.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 4. Audit log: scrubbed metadata + a server-only way to record security events
-- ---------------------------------------------------------------------------
create or replace function private.scrub_audit_metadata(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case jsonb_typeof(p)
    when 'object' then coalesce((
      select jsonb_object_agg(e.key, private.scrub_audit_metadata(e.value))
        from jsonb_each(p) e
       where e.key !~* '(password|passwd|pwd|secret|token|authorization|apikey|api_key|cookie|credential)'), '{}'::jsonb)
    when 'array' then coalesce((select jsonb_agg(private.scrub_audit_metadata(v)) from jsonb_array_elements(p) v), '[]'::jsonb)
    else p
  end
$$;
revoke all on function private.scrub_audit_metadata(jsonb) from public, anon;
grant execute on function private.scrub_audit_metadata(jsonb) to authenticated, service_role;

create or replace function private.write_audit(
  p_action text, p_entity_type text, p_entity_id uuid,
  p_department_id uuid, p_team_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values ((select id from public.profiles where id = auth.uid()), p_action, p_entity_type, p_entity_id,
          p_department_id, p_team_id, private.scrub_audit_metadata(coalesce(p_metadata, '{}'::jsonb)))
$$;
revoke execute on function private.write_audit(text, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- The API server (service role) records events that have no signed-in user: rejected webhooks, sign-in problems.
create or replace function public.record_security_event(p_action text, p_entity_type text default 'security', p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_action !~ '^[A-Z][A-Z0-9_]{1,63}$' or p_entity_type !~ '^[a-z_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: Invalid security event.' using errcode = 'P0001';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (null, p_action, p_entity_type, left(private.scrub_audit_metadata(coalesce(p_metadata, '{}'::jsonb))::text, 4000)::jsonb);
exception when invalid_text_representation then
  insert into public.audit_logs (actor_id, action, entity_type, metadata) values (null, p_action, p_entity_type, '{"truncated":true}'::jsonb);
end $$;
revoke all on function public.record_security_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_security_event(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Sign-in protection (Supabase Auth "password verification attempt" hook)
-- ---------------------------------------------------------------------------
create table if not exists public.auth_login_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_login_attempts_user_idx on public.auth_login_attempts (user_id, created_at desc);
alter table public.auth_login_attempts enable row level security;
revoke all on public.auth_login_attempts from public, anon, authenticated;

-- event: {"user_id": "...", "valid": true|false}. Returns {"decision": "continue" | "reject", "message": "..."}.
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_valid boolean := coalesce((event ->> 'valid')::boolean, false);
  v_failed integer;
  c_max constant integer := 5;
  c_window constant interval := interval '15 minutes';
begin
  begin
    v_user := (event ->> 'user_id')::uuid;
  exception when others then
    return jsonb_build_object('decision', 'continue');
  end;
  if v_user is null then
    return jsonb_build_object('decision', 'continue');
  end if;

  delete from public.auth_login_attempts where created_at < now() - interval '1 day';
  select count(*) into v_failed from public.auth_login_attempts where user_id = v_user and created_at > now() - c_window;

  if v_failed >= c_max then
    -- locked for the rest of the window, whatever password is typed (a correct guess after many wrong ones is not trusted)
    return jsonb_build_object('decision', 'reject',
      'message', 'Too many failed sign-in attempts. Please wait 15 minutes and try again, or ask your administrator.');
  end if;

  if v_valid then
    delete from public.auth_login_attempts where user_id = v_user;
    return jsonb_build_object('decision', 'continue');
  end if;

  insert into public.auth_login_attempts (user_id) values (v_user);
  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values ((select id from public.profiles where id = v_user), 'LOGIN_FAILED', 'auth', jsonb_build_object('userId', v_user, 'attempt', v_failed + 1));
  if v_failed + 1 >= c_max then
    insert into public.audit_logs (actor_id, action, entity_type, metadata)
    values ((select id from public.profiles where id = v_user), 'LOGIN_LOCKED', 'auth', jsonb_build_object('userId', v_user, 'minutes', 15));
  end if;
  return jsonb_build_object('decision', 'continue');
end $$;
revoke all on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
  end if;
end $$;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261110000100_dashboards_overview.sql
-- Dashboards: one company-wide view for the Super Admin, one scoped view for everyone who leads people.
--
-- WHY. The Super Admin landed on a hub of department cards with no numbers, the Sales Team Lead dashboard ran on a browser-only
-- mock store, and the Department Head overview showed tasks but nothing about the customers of the department. Every figure below is
-- worked out here, from the real records, so the screens never calculate (or invent) a total of their own.
--
--   dashboard_company_overview()      Super Admin only. Company-wide: customers by stage, money, invoices, onboarding, tickets, a
--                                     row per department, the income / expense trend, what needs attention, recent activity.
--   dashboard_scope_overview(dept)    Team Lead (the team), Department Head (the department), Super Admin (all, or one department named).
--                                     The scope comes from the caller's role in the database, never from the request.
--
-- Definitions (also shown in the screens):
--   customers by stage      one row of public.customers is one record; LEAD, POTENTIAL, ONBOARDING, CUSTOMER, LOST.
--   income                  verified payments only (private.verified_income): pending and rejected payments are never income.
--   outstanding balance     customers in ONBOARDING / CUSTOMER with an agreed total payable: total payable - verified payments (never < 0).
--   invoices                public.member_invoices (every invoice once), by its Paid / Pending / Overdue status.
--   stalled onboarding      in ONBOARDING and no stage change for 14 days.
--   pending confirmation    a payment_requests row still PENDING (Sales sent it, Accounts has not confirmed).
--
-- Run after 20261108000100_chat.sql. Safe to run again.

-- ---------------------------------------------------------------------------
-- Company-wide (Super Admin)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_company_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', current_date)::date;
  v_prev date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_customers jsonb;
  v_money jsonb;
  v_invoices jsonb;
  v_onboarding jsonb;
  v_tickets jsonb;
  v_departments jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_recent jsonb;
  v_trend jsonb;
  v_pending_n bigint; v_pending_sum numeric; v_pending_old bigint;
  v_stalled bigint; v_failed_inv bigint; v_failed_login bigint; v_failed_jobs bigint; v_locked bigint;
  t jsonb;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can see the company-wide dashboard.' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'total', count(*),
           'leads', count(*) filter (where lifecycle_stage = 'LEAD'),
           'potential', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
           'onboarding', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
           'customers', count(*) filter (where lifecycle_stage = 'CUSTOMER'),
           'lost', count(*) filter (where lifecycle_stage = 'LOST'))
    into v_customers from public.customers;

  select count(*), coalesce(sum(agreed_amount), 0), count(*) filter (where requested_at < now() - interval '2 days')
    into v_pending_n, v_pending_sum, v_pending_old
    from public.payment_requests where status = 'PENDING';

  select jsonb_build_object(
           'incomeThisMonth', coalesce(sum(p.amount) filter (where p.paid_at::date >= v_month), 0),
           'incomeLastMonth', coalesce(sum(p.amount) filter (where p.paid_at::date >= v_prev and p.paid_at::date < v_month), 0),
           'incomeTotal', coalesce(sum(p.amount), 0))
    into v_money from private.verified_income() p;

  v_money := v_money || (
    select jsonb_build_object(
             'expensesThisMonth', coalesce(sum(e.amount) filter (where e.expense_date >= v_month), 0),
             'expensesLastMonth', coalesce(sum(e.amount) filter (where e.expense_date >= v_prev and e.expense_date < v_month), 0),
             'expensesTotal', coalesce(sum(e.amount), 0),
             'expensesPending', coalesce(sum(e.amount) filter (where e.payment_status = 'PENDING'), 0))
      from public.department_expenses e);

  v_money := v_money || jsonb_build_object(
    'pendingConfirmations', v_pending_n,
    'pendingConfirmationsAmount', v_pending_sum,
    'unverifiedPayments', (select count(*) from public.customer_payments where status = 'PENDING'),
    'unverifiedPaymentsAmount', (select coalesce(sum(amount), 0) from public.customer_payments where status = 'PENDING'),
    'outstandingBalance', (select coalesce(sum(greatest(c.deal_amount - c.amount_verified, 0)), 0) from public.customers c
                            where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(c.deal_amount, 0) > 0),
    'customersWithBalance', (select count(*) from public.customers c
                              where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(c.deal_amount, 0) > 0 and c.amount_verified < c.deal_amount));

  select jsonb_build_object(
           'count', count(*),
           'total', coalesce(sum(amount), 0),
           'paid', count(*) filter (where status = 'Paid'),
           'paidAmount', coalesce(sum(amount) filter (where status = 'Paid'), 0),
           'pending', count(*) filter (where status = 'Pending'),
           'pendingAmount', coalesce(sum(amount) filter (where status = 'Pending'), 0),
           'overdue', count(*) filter (where status = 'Overdue'),
           'overdueAmount', coalesce(sum(amount) filter (where status = 'Overdue'), 0))
    into v_invoices from public.member_invoices;

  select jsonb_build_object(
           'inProgress', count(*),
           'withConsultant', count(*) filter (where o.with_consultant),
           'byStage', jsonb_build_object(
             'SALES_CONSULTATION', count(*) filter (where o.stage = 'SALES_CONSULTATION'),
             'COLLECT_REQUIREMENTS', count(*) filter (where o.stage = 'COLLECT_REQUIREMENTS'),
             'SETUP', count(*) filter (where o.stage = 'SETUP'),
             'APPROVAL', count(*) filter (where o.stage = 'APPROVAL'),
             'HANDOVER', count(*) filter (where o.stage = 'HANDOVER'),
             'COMPLETED', count(*) filter (where o.stage = 'COMPLETED')),
           'itemsTotal', coalesce(sum(o.items_total), 0),
           'itemsSaved', coalesce(sum(o.items_saved), 0),
           'itemsVerified', coalesce(sum(o.items_verified), 0),
           'itemsRejected', coalesce(sum(o.items_rejected), 0))
    into v_onboarding
    from public.customers c join public.customer_onboarding o on o.customer_id = c.id
   where c.lifecycle_stage = 'ONBOARDING';

  select count(*) into v_stalled from public.customers c
   where c.lifecycle_stage = 'ONBOARDING' and c.stage_changed_at < now() - interval '14 days';

  select jsonb_build_object(
           'open', count(*),
           'escalated', count(*) filter (where status = 'ESCALATED'),
           'unassigned', count(*) filter (where assignee_id is null),
           'pastSla', count(*) filter (where sla_due_at is not null and sla_due_at < now()))
    into v_tickets from public.support_tickets where status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED');

  -- one row per department: every figure is a grouped sub-query joined on the department, so nothing is multiplied by a join
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'name', d.name, 'slug', d.slug, 'locked', d.is_locked, 'generatesRevenue', d.generates_revenue,
           'staff', coalesce(s.n, 0),
           'leads', coalesce(c.leads, 0), 'potential', coalesce(c.potential, 0), 'onboarding', coalesce(c.onboarding, 0),
           'customers', coalesce(c.customers, 0), 'lost', coalesce(c.lost, 0), 'records', coalesce(c.records, 0),
           'conversionPct', case when coalesce(c.records, 0) - coalesce(c.lost, 0) > 0
                                 then round(100.0 * (coalesce(c.onboarding, 0) + coalesce(c.customers, 0)) / (c.records - c.lost), 1) end,
           'income', coalesce(i.amount, 0), 'incomeThisMonth', coalesce(i.this_month, 0),
           'expenses', coalesce(x.amount, 0), 'expensesPending', coalesce(x.pending, 0),
           'outstanding', coalesce(c.outstanding, 0),
           'openTickets', coalesce(t.n, 0), 'pastSla', coalesce(t.past_sla, 0)) order by d.name), '[]'::jsonb)
    into v_departments
    from public.departments d
    left join (select department_id, count(*) n from public.profiles where status = 'ACTIVE' group by department_id) s on s.department_id = d.id
    left join (select department_id,
                      count(*) records,
                      count(*) filter (where lifecycle_stage = 'LEAD') leads,
                      count(*) filter (where lifecycle_stage = 'POTENTIAL') potential,
                      count(*) filter (where lifecycle_stage = 'ONBOARDING') onboarding,
                      count(*) filter (where lifecycle_stage = 'CUSTOMER') customers,
                      count(*) filter (where lifecycle_stage = 'LOST') lost,
                      coalesce(sum(greatest(deal_amount - amount_verified, 0)) filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(deal_amount, 0) > 0), 0) outstanding
                 from public.customers group by department_id) c on c.department_id = d.id
    left join (select c2.department_id, sum(p.amount) amount, sum(p.amount) filter (where p.paid_at::date >= v_month) this_month
                 from private.verified_income() p join public.customers c2 on c2.id = p.customer_id group by c2.department_id) i on i.department_id = d.id
    left join (select department_id, sum(amount) amount, sum(amount) filter (where payment_status = 'PENDING') pending
                 from public.department_expenses where department_id is not null group by department_id) x on x.department_id = d.id
    left join (select department_id, count(*) n, count(*) filter (where sla_due_at is not null and sla_due_at < now()) past_sla
                 from public.support_tickets where status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED') group by department_id) t on t.department_id = d.id;

  select count(*) into v_failed_inv from public.generated_invoices
   where 'FAILED' in (unpaid_pdf_status, unpaid_email_status, paid_pdf_status, paid_email_status);
  select count(*) into v_failed_login from public.customer_client_provisioning where status = 'FAILED';
  select count(*) into v_failed_jobs from public.automation_jobs where status = 'FAILED' and created_at > now() - interval '7 days';
  select count(*) into v_locked from public.departments where is_locked;

  -- What needs attention: only exceptions that exist, each with its own plain definition.
  if v_pending_old > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'confirmations_late', 'severity', 'high', 'count', v_pending_old, 'page', 'overview',
      'title', 'Payment confirmations waiting more than 2 days', 'hint', 'Sent by Sales, not yet confirmed or returned by Accounts');
  end if;
  if (v_tickets ->> 'pastSla')::int > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'tickets_sla', 'severity', 'high', 'count', (v_tickets ->> 'pastSla')::int,
      'title', 'Open tickets past their SLA', 'hint', 'Customers still waiting for a reply after the promised time');
  end if;
  if (v_tickets ->> 'escalated')::int > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'tickets_escalated', 'severity', 'medium', 'count', (v_tickets ->> 'escalated')::int,
      'title', 'Escalated tickets', 'hint', 'Raised to a lead or head and still open');
  end if;
  if (v_tickets ->> 'unassigned')::int > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'tickets_unassigned', 'severity', 'medium', 'count', (v_tickets ->> 'unassigned')::int,
      'title', 'Open tickets with nobody assigned', 'hint', 'No staff member owns the reply');
  end if;
  if (v_invoices ->> 'overdue')::int > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'invoices_overdue', 'severity', 'high', 'count', (v_invoices ->> 'overdue')::int,
      'title', 'Overdue invoices', 'hint', 'Invoices marked Overdue, totalling ' || private.rupees((v_invoices ->> 'overdueAmount')::numeric));
  end if;
  if v_failed_inv > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'invoice_delivery', 'severity', 'medium', 'count', v_failed_inv,
      'title', 'Invoices whose PDF or e-mail failed', 'hint', 'Accounts can retry them from the invoice');
  end if;
  if v_stalled > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'onboarding_stalled', 'severity', 'medium', 'count', v_stalled,
      'title', 'Onboarding with no progress for 14 days', 'hint', 'Customers whose stage has not changed in two weeks');
  end if;
  if v_failed_login > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'client_logins', 'severity', 'medium', 'count', v_failed_login,
      'title', 'Client logins that could not be created', 'hint', 'Accounts or the consultant must retry');
  end if;
  if v_failed_jobs > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'automation_failed', 'severity', 'low', 'count', v_failed_jobs,
      'title', 'Customer e-mails or WhatsApp messages that failed (7 days)', 'hint', 'Failed sends can be retried from the customer');
  end if;
  if (v_money ->> 'expensesPending')::numeric > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'expenses_pending', 'severity', 'low', 'count', (select count(*) from public.department_expenses where payment_status = 'PENDING'),
      'title', 'Expenses still to be paid', 'hint', private.rupees((v_money ->> 'expensesPending')::numeric) || ' recorded as pending');
  end if;
  if v_locked > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'locked_departments', 'severity', 'low', 'count', v_locked,
      'title', 'Locked departments', 'hint', 'Their staff cannot sign in to them until unlocked');
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('at', a.occurred_at, 'type', a.type, 'note', left(coalesce(a.note, ''), 160),
             'customerId', c.id, 'customer', coalesce(c.company, c.name), 'department', d.name, 'actor', p.full_name) as x
      from public.customer_activities a
      join public.customers c on c.id = a.customer_id
      left join public.departments d on d.id = c.department_id
      left join public.profiles p on p.id = a.actor_id
     order by a.occurred_at desc limit 12) r;

  -- the same trend Accounts sees (verified income vs recorded expenses, month by month)
  t := public.accounts_finance_trend(12);

  return jsonb_build_object(
    'generatedAt', now(),
    'customers', v_customers,
    'money', v_money,
    'invoices', v_invoices,
    'onboarding', v_onboarding || jsonb_build_object('stalled', v_stalled),
    'tickets', v_tickets,
    'departments', v_departments,
    'trend', t -> 'months',
    'alerts', v_alerts,
    'recentActivity', v_recent);
end $$;
revoke all on function public.dashboard_company_overview() from public, anon;
grant execute on function public.dashboard_company_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- Scoped (Team Lead, Department Head; Super Admin for one department)
-- What is counted is decided ONCE, here, from the caller's role (never from anything the browser sends):
--   Super Admin      every record, or one department when named
--   Department Head  their department
--   Team Lead        their team
-- (the same scopes the row-level security policies give these roles on customers, tickets, tasks and people)
-- ---------------------------------------------------------------------------
create or replace function private.scope_customers(p_department uuid)
returns setof public.customers language sql stable security definer set search_path = '' as $$
  select c.* from public.customers c
   where case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or c.department_id = p_department)
           when 'DEPARTMENT_HEAD' then c.department_id = private.my_department_id()
           when 'TEAM_HEAD' then c.team_id = private.my_team_id()
           else false end
$$;
revoke all on function private.scope_customers(uuid) from public, anon, authenticated;

create or replace function private.scope_tickets(p_department uuid)
returns setof public.support_tickets language sql stable security definer set search_path = '' as $$
  select t.* from public.support_tickets t
   where t.status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED')
     and case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or t.department_id = p_department)
           when 'DEPARTMENT_HEAD' then t.department_id = private.my_department_id()
           when 'TEAM_HEAD' then t.team_id = private.my_team_id()
           else false end
$$;
revoke all on function private.scope_tickets(uuid) from public, anon, authenticated;

create or replace function private.scope_tasks(p_department uuid)
returns setof public.work_tasks language sql stable security definer set search_path = '' as $$
  select w.* from public.work_tasks w
   where w.parent_id is null
     and case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or w.department_id = p_department)
           when 'DEPARTMENT_HEAD' then w.department_id = private.my_department_id()
           when 'TEAM_HEAD' then w.team_id = private.my_team_id()
           else false end
$$;
revoke all on function private.scope_tasks(uuid) from public, anon, authenticated;

create or replace function private.scope_people(p_department uuid)
returns setof public.profiles language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p
   where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and p.team_id is not null
     and case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or p.department_id = p_department)
           when 'DEPARTMENT_HEAD' then p.department_id = private.my_department_id()
           when 'TEAM_HEAD' then p.team_id = private.my_team_id()
           else false end
$$;
revoke all on function private.scope_people(uuid) from public, anon, authenticated;

create or replace function public.dashboard_scope_overview(p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_dept uuid;
  v_team uuid;
  v_customers jsonb;
  v_pipeline jsonb;
  v_money jsonb;
  v_onboarding jsonb;
  v_tickets jsonb;
  v_tasks jsonb;
  v_members jsonb;
  v_teams jsonb;
  v_recent jsonb;
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') then
    raise exception 'FORBIDDEN: This overview is for Team Leads, Department Heads and the Super Admin.' using errcode = '42501';
  end if;
  v_dept := case v_role when 'SUPER_ADMIN' then p_department else private.my_department_id() end;
  v_team := case v_role when 'TEAM_HEAD' then private.my_team_id() end;

  select jsonb_build_object(
           'total', count(*),
           'leads', count(*) filter (where lifecycle_stage = 'LEAD'),
           'potential', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
           'onboarding', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
           'customers', count(*) filter (where lifecycle_stage = 'CUSTOMER'),
           'lost', count(*) filter (where lifecycle_stage = 'LOST'))
    into v_customers from private.scope_customers(p_department) c;

  select jsonb_build_object(
           'followUpsOverdue', count(*) filter (where lifecycle_stage in ('LEAD', 'POTENTIAL') and next_follow_up_at < now()),
           'followUpsToday', count(*) filter (where lifecycle_stage in ('LEAD', 'POTENTIAL') and next_follow_up_at >= now()
                                                and (next_follow_up_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date),
           'leadsWithoutFollowUp', count(*) filter (where lifecycle_stage = 'LEAD' and next_follow_up_at is null),
           'newLeadsThisWeek', count(*) filter (where lifecycle_stage = 'LEAD' and created_at >= now() - interval '7 days'),
           'wonThisMonth', count(*) filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and stage_changed_at >= date_trunc('month', now())))
    into v_pipeline from private.scope_customers(p_department) c;

  select jsonb_build_object(
           'pendingConfirmations', (select count(*) from public.payment_requests r join private.scope_customers(p_department) c on c.id = r.customer_id where r.status = 'PENDING'),
           'unverifiedPayments', (select count(*) from public.customer_payments p join private.scope_customers(p_department) c on c.id = p.customer_id where p.status = 'PENDING'),
           'outstandingBalance', coalesce(sum(greatest(deal_amount - amount_verified, 0))
                                   filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(deal_amount, 0) > 0), 0),
           'customersWithBalance', count(*) filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(deal_amount, 0) > 0 and amount_verified < deal_amount),
           'verifiedReceived', coalesce(sum(amount_verified), 0))
    into v_money from private.scope_customers(p_department) c;

  select jsonb_build_object(
           'inProgress', count(*),
           'waitingForDepartmentHead', count(*) filter (where o.handover_stage = 'DEPARTMENT_HEAD'),
           'waitingForTeamLead', count(*) filter (where o.handover_stage = 'TEAM_LEAD'),
           'withTeamMember', count(*) filter (where o.handover_stage = 'TEAM_MEMBER'),
           'itemsTotal', coalesce(sum(o.items_total), 0),
           'itemsVerified', coalesce(sum(o.items_verified), 0),
           'stalled', count(*) filter (where c.stage_changed_at < now() - interval '14 days'))
    into v_onboarding
    from private.scope_customers(p_department) c join public.customer_onboarding o on o.customer_id = c.id
   where c.lifecycle_stage = 'ONBOARDING';

  select jsonb_build_object(
           'open', count(*),
           'escalated', count(*) filter (where status = 'ESCALATED'),
           'unassigned', count(*) filter (where assignee_id is null),
           'pastSla', count(*) filter (where sla_due_at is not null and sla_due_at < now()))
    into v_tickets from private.scope_tickets(p_department) t;

  select jsonb_build_object(
           'open', count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED')),
           'overdue', count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED') and due_date < current_date),
           'blocked', count(*) filter (where status = 'BLOCKED'),
           'completedThisWeek', count(*) filter (where status = 'COMPLETED' and completed_at >= now() - interval '7 days'))
    into v_tasks from private.scope_tasks(p_department) w;

  -- Each person once: customers they own, follow-ups, open tasks and when they last logged something.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.full_name, 'role', p.role, 'team', t.name, 'teamId', p.team_id,
           'leads', coalesce(c.leads, 0), 'potential', coalesce(c.potential, 0), 'onboarding', coalesce(c.onboarding, 0),
           'customers', coalesce(c.customers, 0), 'records', coalesce(c.records, 0),
           'followUpsOverdue', coalesce(c.overdue, 0),
           'openTasks', coalesce(w.open_n, 0), 'overdueTasks', coalesce(w.overdue_n, 0),
           'lastActivityAt', a.last_at) order by t.name, p.role desc, p.full_name), '[]'::jsonb)
    into v_members
    from private.scope_people(p_department) p
    join public.teams t on t.id = p.team_id
    left join (select owner_id,
                      count(*) records,
                      count(*) filter (where lifecycle_stage = 'LEAD') leads,
                      count(*) filter (where lifecycle_stage = 'POTENTIAL') potential,
                      count(*) filter (where lifecycle_stage = 'ONBOARDING') onboarding,
                      count(*) filter (where lifecycle_stage = 'CUSTOMER') customers,
                      count(*) filter (where lifecycle_stage in ('LEAD', 'POTENTIAL') and next_follow_up_at < now()) overdue
                 from private.scope_customers(p_department) where lifecycle_stage <> 'LOST' group by owner_id) c on c.owner_id = p.id
    left join (select assignee_id, count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED')) open_n,
                      count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED') and due_date < current_date) overdue_n
                 from private.scope_tasks(p_department) group by assignee_id) w on w.assignee_id = p.id
    left join (select actor_id, max(occurred_at) last_at from public.customer_activities
                where customer_id in (select id from private.scope_customers(p_department)) group by actor_id) a on a.actor_id = p.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'division', t.division,
           'members', coalesce(m.n, 0), 'records', coalesce(c.records, 0), 'leads', coalesce(c.leads, 0),
           'onboarding', coalesce(c.onboarding, 0), 'customers', coalesce(c.customers, 0)) order by t.name), '[]'::jsonb)
    into v_teams
    from public.teams t
    left join (select team_id, count(*) n from private.scope_people(p_department) group by team_id) m on m.team_id = t.id
    left join (select team_id, count(*) records, count(*) filter (where lifecycle_stage = 'LEAD') leads,
                      count(*) filter (where lifecycle_stage = 'ONBOARDING') onboarding, count(*) filter (where lifecycle_stage = 'CUSTOMER') customers
                 from private.scope_customers(p_department) where lifecycle_stage <> 'LOST' group by team_id) c on c.team_id = t.id
   where (v_dept is null or t.department_id = v_dept) and (v_team is null or t.id = v_team);

  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('at', a.occurred_at, 'type', a.type, 'note', left(coalesce(a.note, ''), 160),
             'customerId', c.id, 'customer', coalesce(c.company, c.name), 'actor', p.full_name) as x
      from public.customer_activities a
      join private.scope_customers(p_department) c on c.id = a.customer_id
      left join public.profiles p on p.id = a.actor_id
     order by a.occurred_at desc limit 10) r;

  return jsonb_build_object(
    'generatedAt', now(),
    'scope', jsonb_build_object('role', v_role, 'departmentId', v_dept, 'teamId', v_team),
    'customers', v_customers, 'pipeline', v_pipeline, 'money', v_money, 'onboarding', v_onboarding,
    'tickets', v_tickets, 'tasks', v_tasks, 'members', v_members, 'teams', v_teams, 'recentActivity', v_recent);
end $$;
revoke all on function public.dashboard_scope_overview(uuid) from public, anon;
grant execute on function public.dashboard_scope_overview(uuid) to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261110000200_security_events.sql
-- Security and audit events: the smallest set of changes that makes the existing audit trail reliable and reviewable.
--
-- WHAT EXISTED (see docs/SECURITY.md): public.audit_logs written by triggers and SECURITY DEFINER functions (customers, payments, invoices,
-- documents, roles, ...), failed sign-ins through the Auth password hook, rejected lead webhooks. Protected from API roles by grants only.
--
-- WHAT THIS ADDS
--   1. audit_logs gets: outcome (SUCCESS / FAILURE / DENIED), the actor's role and a name snapshot (so deleting a person never erases
--      who did something), the request id (so a row can be tied to the request that caused it), the caller's address for server-side
--      events, and a dedupe key (a retried request records one event).
--   2. Every insert is scrubbed of secrets and stamped with the request id by a BEFORE INSERT trigger - including the writers that
--      insert directly. (Rows written earlier are not rewritten, except to fill the new columns.)
--   3. Audit rows are append-only in the database itself: a trigger refuses UPDATE and DELETE (the one allowed UPDATE is the foreign-key
--      clean-up that sets a removed person / department / team reference to NULL) and TRUNCATE. A deliberate clean-up must say so with
--      set_config('amuwa.audit_purge', 'on', true) (the maintenance script does).
--   4. public.record_server_event: the API server records what the database cannot (a refused request rolls its own transaction back):
--      denied / unauthenticated requests, rate limiting and the start of a session. service_role only; deduplicated.
--   5. public.record_data_export: an export of records from the browser is recorded with who, what and how many rows.
--   6. Chat group membership and role changes are audited (trigger on chat_members, so every path is covered).
--   7. public.audit_log_search / audit_log_actions: search by actor, action, request id, outcome and dates; paged; read-only; scoped by the
--      table's row-level security (Super Admin: all, Department Head: the department, Team Lead: the team).
--
-- Run after 20261110000100_dashboards_overview.sql. Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.audit_logs add column if not exists outcome text not null default 'SUCCESS' check (outcome in ('SUCCESS', 'FAILURE', 'DENIED'));
alter table public.audit_logs add column if not exists actor_role text;
alter table public.audit_logs add column if not exists actor_label text check (length(actor_label) <= 200);
alter table public.audit_logs add column if not exists request_id text check (length(request_id) <= 128);
alter table public.audit_logs add column if not exists ip text check (length(ip) <= 64);
alter table public.audit_logs add column if not exists dedupe_key text check (length(dedupe_key) <= 240);
create unique index if not exists audit_logs_dedupe_key on public.audit_logs (dedupe_key) where dedupe_key is not null;
create index if not exists audit_logs_outcome_idx on public.audit_logs (created_at desc) where outcome <> 'SUCCESS';
create index if not exists audit_logs_request_idx on public.audit_logs (request_id) where request_id is not null;

-- The append-only guard must not be in the way of the one-time fill of the new columns below.
drop trigger if exists audit_logs_protect on public.audit_logs;
update public.audit_logs a
   set actor_role = p.role::text, actor_label = left(p.full_name || ' <' || p.email || '>', 200)
  from public.profiles p
 where a.actor_id = p.id and a.actor_label is null;
update public.audit_logs set outcome = 'FAILURE' where outcome = 'SUCCESS' and action in ('LOGIN_FAILED', 'CLIENT_LOGIN_FAILED', 'AUTOMATION_FAILED');
update public.audit_logs set outcome = 'DENIED' where outcome = 'SUCCESS' and action in ('LOGIN_LOCKED', 'WEBHOOK_REJECTED');

-- ---------------------------------------------------------------------------
-- 2. Every insert: scrub secrets, stamp the request id, the actor's role and name, and the outcome of the well-known failures
-- ---------------------------------------------------------------------------
create or replace function private.tg_audit_logs_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_headers jsonb;
  v_rid text;
  p public.profiles;
begin
  new.metadata := private.scrub_audit_metadata(coalesce(new.metadata, '{}'::jsonb));
  if new.request_id is null then
    begin
      v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      v_headers := null;
    end;
    v_rid := v_headers ->> 'x-request-id';
    -- the id is only a correlation label: keep it short and plain
    if v_rid ~ '^[A-Za-z0-9._:-]{1,128}$' then
      new.request_id := v_rid;
    end if;
  end if;
  if new.actor_id is not null and (new.actor_role is null or new.actor_label is null) then
    select * into p from public.profiles where id = new.actor_id;
    if p.id is not null then
      new.actor_role := coalesce(new.actor_role, p.role::text);
      new.actor_label := coalesce(new.actor_label, left(p.full_name || ' <' || p.email || '>', 200));
    end if;
  end if;
  if new.outcome = 'SUCCESS' then
    if new.action in ('LOGIN_FAILED', 'CLIENT_LOGIN_FAILED', 'AUTOMATION_FAILED') then
      new.outcome := 'FAILURE';
    elsif new.action in ('LOGIN_LOCKED', 'WEBHOOK_REJECTED') then
      new.outcome := 'DENIED';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_audit_logs_before_insert() from public, anon, authenticated;
drop trigger if exists audit_logs_before_insert on public.audit_logs;
create trigger audit_logs_before_insert before insert on public.audit_logs
  for each row execute function private.tg_audit_logs_before_insert();

-- ---------------------------------------------------------------------------
-- 3. Append-only
-- ---------------------------------------------------------------------------
create or replace function private.tg_audit_logs_protect()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('amuwa.audit_purge', true), '') = 'on' then
      return old;
    end if;
    raise exception 'FORBIDDEN: Audit records cannot be deleted.' using errcode = '42501';
  end if;
  -- UPDATE: only the foreign-key action that clears the reference to a removed person, department or team
  if (to_jsonb(new) - 'actor_id' - 'department_id' - 'team_id') is distinct from (to_jsonb(old) - 'actor_id' - 'department_id' - 'team_id')
     or (new.actor_id is distinct from old.actor_id and new.actor_id is not null)
     or (new.department_id is distinct from old.department_id and new.department_id is not null)
     or (new.team_id is distinct from old.team_id and new.team_id is not null) then
    raise exception 'FORBIDDEN: Audit records cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_audit_logs_protect() from public, anon, authenticated;
create trigger audit_logs_protect before update or delete on public.audit_logs
  for each row execute function private.tg_audit_logs_protect();

create or replace function private.tg_audit_logs_no_truncate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('amuwa.audit_purge', true), '') = 'on' then
    return null;
  end if;
  raise exception 'FORBIDDEN: Audit records cannot be deleted.' using errcode = '42501';
end $$;
revoke all on function private.tg_audit_logs_no_truncate() from public, anon, authenticated;
drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.tg_audit_logs_no_truncate();

-- ---------------------------------------------------------------------------
-- 4. Events the API server records (a refused request leaves nothing behind in the database otherwise)
-- ---------------------------------------------------------------------------
create or replace function public.record_server_event(
  p_action text, p_entity_type text, p_entity_id uuid, p_actor uuid, p_outcome text,
  p_request_id text, p_ip text, p_dedupe_key text, p_metadata jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_action is null or p_action !~ '^[A-Z][A-Z0-9_]{1,63}$' or p_entity_type is null or p_entity_type !~ '^[a-z_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: Unknown event.' using errcode = 'P0001';
  end if;
  if p_outcome not in ('SUCCESS', 'FAILURE', 'DENIED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  if length(v_meta::text) > 4000 then
    v_meta := jsonb_build_object('truncated', true);
  end if;
  if p_actor is not null then
    select * into p from public.profiles where id = p_actor;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, outcome, request_id, ip, dedupe_key, metadata)
  values (p.id, p_action, p_entity_type, p_entity_id, p.department_id, p.team_id, p_outcome,
          nullif(left(p_request_id, 128), ''), nullif(left(p_ip, 64), ''), nullif(left(p_dedupe_key, 240), ''), v_meta)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return found;
end $$;
revoke all on function public.record_server_event(text, text, uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_server_event(text, text, uuid, uuid, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Exports done in the browser
-- ---------------------------------------------------------------------------
create or replace function public.record_data_export(p_dataset text, p_rows integer, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if p.id is null then
    raise exception 'FORBIDDEN: Sign in to record an export.' using errcode = '42501';
  end if;
  if p_dataset is null or p_dataset !~ '^[a-z_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: Unknown dataset.' using errcode = 'P0001';
  end if;
  perform private.write_audit('DATA_EXPORTED', 'export', null, p.department_id, p.team_id,
    jsonb_build_object('dataset', p_dataset, 'rows', greatest(least(coalesce(p_rows, 0), 10000000), 0), 'note', left(nullif(btrim(coalesce(p_note, '')), ''), 200)));
end $$;
revoke all on function public.record_data_export(text, integer, text) from public, anon;
grant execute on function public.record_data_export(text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Chat membership
-- ---------------------------------------------------------------------------
create or replace function private.tg_chat_members_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
begin
  select * into c from public.chat_conversations where id = new.conversation_id;
  -- Direct chats and the client chat of a customer are made by the system; group membership is a decision of people.
  if c.id is null or c.kind <> 'GROUP' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform private.write_audit('CHAT_MEMBER_ADDED', 'chat_conversation', c.id, null, null,
      jsonb_build_object('member', new.profile_id, 'role', new.role, 'title', c.title));
  elsif old.left_at is not null and new.left_at is null then
    perform private.write_audit('CHAT_MEMBER_ADDED', 'chat_conversation', c.id, null, null,
      jsonb_build_object('member', new.profile_id, 'role', new.role, 'title', c.title, 'rejoined', true));
  elsif old.left_at is null and new.left_at is not null then
    perform private.write_audit(case when new.removed_by is null then 'CHAT_MEMBER_LEFT' else 'CHAT_MEMBER_REMOVED' end, 'chat_conversation', c.id, null, null,
      jsonb_build_object('member', new.profile_id, 'removed_by', new.removed_by, 'title', c.title));
  elsif old.role is distinct from new.role then
    perform private.write_audit('CHAT_MEMBER_ROLE_CHANGED', 'chat_conversation', c.id, null, null,
      jsonb_build_object('member', new.profile_id, 'from', old.role, 'to', new.role, 'title', c.title));
  end if;
  return new;
end $$;
revoke all on function private.tg_chat_members_audit() from public, anon, authenticated;
drop trigger if exists chat_members_audit on public.chat_members;
create trigger chat_members_audit after insert or update on public.chat_members
  for each row execute function private.tg_chat_members_audit();

-- ---------------------------------------------------------------------------
-- 7. Reading: search, filters, pages. SECURITY INVOKER: audit_logs' own row-level security decides what is visible.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_search(
  p_search text default null, p_action text default null, p_outcome text default null, p_entity_type text default null,
  p_from date default null, p_to date default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_total bigint;
  v_items jsonb;
begin
  if private.my_role() is null or private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') then
    raise exception 'FORBIDDEN: Only managers can read the audit log.' using errcode = '42501';
  end if;
  if p_outcome is not null and p_outcome not in ('SUCCESS', 'FAILURE', 'DENIED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;

  select count(*) into v_total from public.audit_logs a
   where (p_action is null or a.action = p_action)
     and (p_outcome is null or a.outcome = p_outcome)
     and (p_entity_type is null or a.entity_type = p_entity_type)
     and (p_from is null or a.created_at >= p_from::timestamptz)
     and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
     and (v_term is null or lower(a.action) like '%' || v_term || '%' or lower(coalesce(a.actor_label, '')) like '%' || v_term || '%'
          or lower(coalesce(a.request_id, '')) like '%' || v_term || '%' or a.entity_id::text = v_term);

  select coalesce(jsonb_agg(x.j order by x.created_at desc, x.id desc), '[]'::jsonb) into v_items from (
    select a.id, a.created_at, jsonb_build_object(
             'id', a.id, 'at', a.created_at, 'action', a.action, 'entityType', a.entity_type, 'entityId', a.entity_id,
             'outcome', a.outcome, 'actorId', a.actor_id, 'actor', coalesce(a.actor_label, pr.full_name), 'actorRole', a.actor_role,
             'departmentId', a.department_id, 'department', d.name, 'requestId', a.request_id, 'ip', a.ip, 'metadata', a.metadata) as j
      from public.audit_logs a
      left join public.profiles pr on pr.id = a.actor_id
      left join public.departments d on d.id = a.department_id
     where (p_action is null or a.action = p_action)
       and (p_outcome is null or a.outcome = p_outcome)
       and (p_entity_type is null or a.entity_type = p_entity_type)
       and (p_from is null or a.created_at >= p_from::timestamptz)
       and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
       and (v_term is null or lower(a.action) like '%' || v_term || '%' or lower(coalesce(a.actor_label, '')) like '%' || v_term || '%'
            or lower(coalesce(a.request_id, '')) like '%' || v_term || '%' or a.entity_id::text = v_term)
     order by a.created_at desc, a.id desc
     limit v_size offset (v_page - 1) * v_size) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.audit_log_search(text, text, text, text, date, date, integer, integer) from public, anon;
grant execute on function public.audit_log_search(text, text, text, text, date, date, integer, integer) to authenticated;

create or replace function public.audit_log_actions()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if private.my_role() is null or private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') then
    raise exception 'FORBIDDEN: Only managers can read the audit log.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(action order by action) from (select distinct action from public.audit_logs) t), '[]'::jsonb);
end $$;
revoke all on function public.audit_log_actions() from public, anon;
grant execute on function public.audit_log_actions() to authenticated;

notify pgrst, 'reload schema';
