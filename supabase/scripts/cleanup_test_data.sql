-- =============================================================================
-- One-off cleanup of test / dummy data. NOT a migration: run it by hand in the
-- Supabase SQL editor, one step at a time, after reading the preview output.
-- Deletes cannot be undone - take a backup first (Database → Backups).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 · PREVIEW what would be removed (changes nothing)
-- ---------------------------------------------------------------------------
-- Inbound enquiries nobody has taken yet (the "New enquiries" strip):
select id, name, phone, company, channel, created_at
  from public.crm_leads
 where converted_customer_id is null
 order by created_at desc;

-- Leads that were copied from old enquiries but never progressed past "Lead":
select c.id, c.name, c.company, c.lead_status, c.created_at, o.full_name as owner
  from public.customers c
  left join public.profiles o on o.id = c.owner_id
 where c.source_lead_id is not null and c.lifecycle_stage = 'LEAD'
 order by c.created_at desc;

-- ---------------------------------------------------------------------------
-- STEP 2 · DELETE the old enquiries (inbound table is kept: the website and
-- WhatsApp webhooks still write new enquiries into it)
-- ---------------------------------------------------------------------------
-- begin;
-- -- Optional (run first if you want it): remove leads copied from old enquiries.
-- -- Their enquiries then become untaken and are removed by the next line.
-- delete from public.customers where source_lead_id is not null and lifecycle_stage = 'LEAD';
-- delete from public.crm_leads where converted_customer_id is null;
-- commit;

-- ---------------------------------------------------------------------------
-- STEP 3 · OPTIONAL: drop legacy tables that no screen uses any more.
-- (crm_leads, hr_employees and hr_attendance are still used - keep them.)
-- ---------------------------------------------------------------------------
-- select count(*) from public.blueprint_requirements;
-- select count(*) from public.hr_leave_applications;
-- drop table if exists public.blueprint_requirements;
-- drop table if exists public.hr_leave_applications;
