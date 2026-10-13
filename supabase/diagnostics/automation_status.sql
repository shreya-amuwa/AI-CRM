-- Why did a customer get no email / WhatsApp?  READ-ONLY: it only SELECTs. Run in the Supabase SQL editor.
-- Shows no email addresses or phone numbers.

-- 1. Is the migration applied? (all four must say true)
select
  exists (select 1 from information_schema.columns where table_name = 'customer_onboarding' and column_name = 'client_status') as stage_column,
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'automation_jobs') as outbox_table,
  exists (select 1 from pg_trigger where tgname = 'customer_onboarding_client_status') as stage_trigger,
  exists (select 1 from pg_proc where proname = 'consultant_resend_client_messages') as resend_function;

-- 2. The 15 most recent customers that reached the Technical Consultant, with their step and messages
select c.customer_code,
       c.company,
       d.slug as department,
       private.automation_eligible(c.id) as automated,           -- false = Wabastore + WhatsApp API + Blue Tick is not met
       o.client_status as step,                                  -- empty = no step recorded yet
       o.client_status_changed_at as step_since,
       o.forwarded_to_support_at as reached_tc_at,
       (select count(*) from public.automation_jobs j where j.customer_id = c.id) as messages_queued,
       (select string_agg(j.channel || '/' || j.stage || ': ' || j.status || coalesce(' - ' || j.detail, ''), E'\n' order by j.created_at)
          from public.automation_jobs j where j.customer_id = c.id) as messages
  from public.customers c
  join public.departments d on d.id = c.department_id
  join public.customer_onboarding o on o.customer_id = c.id
 where o.forwarded_to_support_at is not null
 order by o.forwarded_to_support_at desc
 limit 15;

-- 3. Messages that did not go out, newest first, with the reason
select j.created_at, c.customer_code, j.channel, j.stage, j.status, j.attempts, j.detail
  from public.automation_jobs j
  join public.customers c on c.id = j.customer_id
 where j.status in ('SKIPPED', 'FAILED', 'QUEUED', 'SENDING')
 order by j.created_at desc
 limit 30;
