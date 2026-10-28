-- =============================================================================
-- Records that may need a person's decision after the role redesign. READ ONLY - nothing is changed.
-- Run it in the Supabase SQL editor after the 4 migrations (supabase/run_these_4_migrations_roles_provisioning.sql).
-- =============================================================================

-- 1. Department Heads who manage more than one department. They were NOT made Operations Heads and did NOT lose access: their extra
--    departments are kept (marked "transition"). The Super Admin decides per person: make them an Operations Head, or remove the extra
--    departments (Team Member Management > Access Control shows the same list).
select p.full_name, p.email, d.name as home_department, a.department_id, dd.name as extra_department, a.division
  from public.department_access a
  join public.profiles p on p.id = a.profile_id and not p.is_operations_head
  join public.departments d on d.id = p.department_id
  join public.departments dd on dd.id = a.department_id
 where a.transition
 order by p.full_name, dd.name;

-- 2. Customers already in verification on the Technical Consultant route although their services now ask for a Meta Verifier.
--    They keep their route (work in flight is never moved); the Super Admin or the Department Head can move one on its screen.
select c.customer_code, coalesce(c.company, c.name) as customer, d.name as department, o.verification_route, o.review_state
  from public.customers c
  join public.customer_onboarding o on o.customer_id = c.id
  join public.departments d on d.id = c.department_id
 where o.forwarded_to_support_at is not null and o.handover_stage = 'CONSULTANT' and c.lifecycle_stage = 'ONBOARDING'
   and o.verification_route is distinct from private.computed_route(c.id)
 order by c.created_at;

-- 3. Departments with WhatsApp customers but no active Meta Verifier (a new WhatsApp customer cannot be sent for verification there).
select d.name as department, count(*) as whatsapp_customers_in_onboarding
  from public.customers c join public.departments d on d.id = c.department_id
 where c.lifecycle_stage = 'ONBOARDING'
   and exists (select 1 from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id and s.requires_meta_verification)
   and not exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                    where p.status = 'ACTIVE' and p.is_meta_verifier and t.division = 'SUPPORT' and p.department_id = c.department_id)
 group by d.name;

-- 4. Follow-ups waiting because the number of days has not been set (Team Member Management > Workflow).
select count(*) as followups_waiting_for_the_delay from public.tc_followups where status = 'AWAITING_CONFIGURATION';

-- 5. Client logins whose e-mail differs from the e-mail on the customer record (made by the consultant before this change). Nothing is
--    changed for them; this only shows where the record and the login disagree.
select c.customer_code, coalesce(c.company, c.name) as customer, c.email as record_email, a.email as login_email, a.created_at
  from public.customer_client_accounts a join public.customers c on c.id = a.customer_id
 where lower(coalesce(c.email, '')) <> a.email
 order by a.created_at desc;

-- 6. Customers with a verified payment and no client login yet (Accounts > Client Logins lists them), and why one cannot be created.
select c.customer_code, coalesce(c.company, c.name) as customer, c.email,
       private.client_email_problem(c.id, c.email) as email_problem
  from public.customers c
 where c.amount_verified > 0 and c.lifecycle_stage in ('LEAD', 'ONBOARDING', 'CUSTOMER')
   and not exists (select 1 from public.customer_client_accounts a where a.customer_id = c.id)
 order by c.created_at;

-- 7. The same e-mail on more than one customer record (a login can be made for only one of them).
select lower(email) as email, count(*) as customers, string_agg(coalesce(company, name), ', ') as which
  from public.customers where nullif(btrim(email), '') is not null
 group by lower(email) having count(*) > 1;

-- 8. Passwords that used to be kept for the "Status Completed" e-mail: none may remain.
select count(*) as jobs_still_holding_a_secret from public.automation_jobs where secret is not null;
