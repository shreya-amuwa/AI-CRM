-- Display text uses a plain "-" instead of the long dash. The seed migrations were updated; this brings
-- rows that were already inserted in a live database in line. Idempotent.
update public.crm_services set name = replace(name, '—', '-') where name like '%—%';
update public.onboarding_items set label = replace(label, '—', '-'), hint = replace(hint, '—', '-') where label like '%—%' or hint like '%—%';
update public.document_types set label = replace(label, '—', '-'), description = replace(description, '—', '-') where label like '%—%' or description like '%—%';
