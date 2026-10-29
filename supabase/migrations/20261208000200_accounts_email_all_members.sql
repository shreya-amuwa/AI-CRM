-- =============================================================================
-- Payment requests are emailed to EVERY eligible Accounts member, not to one.
--
-- What was wrong (audit)
--   20261017000100_accounts_payment_email.sql chose "exactly one person per request": the accountant assigned to the customer, else the
--   lowest payment_desk_order, else the longest-serving Accounts person (private.payment_desk_email(), LIMIT 1). With two Accounts members
--   only one of them ever got the email; the bell notification already went to all of them. Nothing was hardcoded: the recipient came
--   from department membership, and the cut-off was the design.
--
-- Now
--   private.payment_desk_recipients(): every ACTIVE member of the Accounts department that has a valid e-mail address, once per address
--   (two profiles sharing an address are one recipient). One automation_jobs row per recipient, so each person's dispatch has its own
--   status, retries and log line; an invalid address or a provider failure on one never stops the other.
--   Only Accounts is emailed, and only for requests that wait for Accounts (PAYMENT_CONFIRMATION_REQUESTED, PAYMENT_TO_VERIFY,
--   ADDON_SUBMITTED). Customers have their own emails; nobody else is emailed.
--   The email carries the customer, its CRM reference, who sent it and what to do - no amounts and no customer phone / e-mail: Accounts
--   opens the request in the CRM for those.
--   payment_desk_order / accounts_owner_id no longer narrow the recipients (they stay for the CRM's own use).
--
-- Safe to run again. Nothing is sent by running it.
-- =============================================================================

create or replace function private.payment_desk_recipients()
returns table (profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct on (lower(btrim(p.email))) p.id, lower(btrim(p.email)), p.full_name
    from public.profiles p
    join public.departments d on d.id = p.department_id and d.slug = 'accounts'
   where p.status = 'ACTIVE' and p.email is not null and btrim(p.email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
   order by lower(btrim(p.email)), p.created_at, p.id
$$;
revoke all on function private.payment_desk_recipients() from public, anon, authenticated;

-- the older single-recipient function now answers with the first of the same list (kept for anything that still asks for one address)
create or replace function private.payment_desk_email(p_customer uuid)
returns table (profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select r.profile_id, r.email, r.full_name from private.payment_desk_recipients() r
   order by (select p.created_at from public.profiles p where p.id = r.profile_id), r.profile_id limit 1
$$;
revoke all on function private.payment_desk_email(uuid) from public, anon, authenticated;

create or replace function private.queue_accounts_email(p_kind text, p_customer uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v public.customers;
  s record;
begin
  select * into v from public.customers where id = p_customer;
  select p.full_name, dp.name as department into s
    from public.profiles p left join public.departments dp on dp.id = p.department_id where p.id = (select private.my_id());
  -- one job per recipient: its own status, retries and log line. (No body, amount, phone or e-mail of the customer goes into the job.)
  for d in select * from private.payment_desk_recipients() loop
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, internal, context, created_by)
    values (p_customer, 'EMAIL', 'ACCOUNTS_PAYMENT', format('ACCOUNTS|%s|%s|%s|%s', p_kind, p_customer, d.profile_id, gen_random_uuid()), true,
            jsonb_strip_nulls(jsonb_build_object(
              'to', d.email, 'toName', d.full_name, 'kind', p_kind, 'title', left(p_title, 200),
              'customer', coalesce(v.company, v.name), 'contact', v.name, 'reference', v.customer_code,
              'from', s.full_name, 'fromDepartment', s.department)),
            (select private.my_id()));
  end loop;
end $$;
revoke all on function private.queue_accounts_email(text, uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
