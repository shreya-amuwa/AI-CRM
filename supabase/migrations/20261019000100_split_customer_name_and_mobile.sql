-- =============================================================================
-- Sales "Customer onboarding": the one card "Contact person & mobile" becomes two separate items,
-- "Customer Name" and "Mobile Number".
--
-- * The old item is switched off (kept in the table so history stays valid).
-- * Customers who already saved the old item get both new items filled from their customer record,
--   with the same status (saved / verified), so nobody loses progress.
-- * Progress counters are refreshed for every customer in onboarding.
-- Additive / re-runnable.
-- =============================================================================
insert into public.onboarding_items (code, section, label, hint, kind, options, always_required, sort_order) values
  ('CUSTOMER_NAME', 'BUSINESS_BASICS', 'Customer Name', 'The customer''s full name - who we coordinate with', 'DETAILS', null, true, 20),
  ('CUSTOMER_MOBILE', 'BUSINESS_BASICS', 'Mobile Number', 'The customer''s mobile number', 'DETAILS', null, true, 25)
on conflict (code) do update set label = excluded.label, hint = excluded.hint, kind = excluded.kind,
  always_required = excluded.always_required, sort_order = excluded.sort_order, is_active = true;

update public.onboarding_items set is_active = false where code = 'CONTACT_PERSON_MOBILE';

-- carry over what was already collected
insert into public.customer_onboarding_entries (customer_id, item_code, value, status, saved_by, saved_at, reviewed_by, reviewed_at, review_note)
select e.customer_id, n.code, n.value, e.status, e.saved_by, e.saved_at, e.reviewed_by, e.reviewed_at, e.review_note
  from public.customer_onboarding_entries e
  join public.customers c on c.id = e.customer_id
  cross join lateral (values ('CUSTOMER_NAME', nullif(btrim(c.name), '')), ('CUSTOMER_MOBILE', nullif(btrim(c.phone), ''))) n(code, value)
 where e.item_code = 'CONTACT_PERSON_MOBILE' and e.status in ('SAVED', 'VERIFIED') and n.value is not null
on conflict (customer_id, item_code) do nothing;

do $$
declare
  v_customer uuid;
begin
  for v_customer in select customer_id from public.customer_onboarding loop
    perform private.refresh_onboarding_progress(v_customer);
  end loop;
end $$;
