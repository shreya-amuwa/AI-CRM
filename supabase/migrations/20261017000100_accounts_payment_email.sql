-- =============================================================================
-- Email the Accounts payment desk when Sales or the Technical Consultant sends a payment request.
--
-- Until now Accounts only got a bell notification (inside the CRM). Now the person who handles the
-- request also gets an email from the CRM's mail sender, through the same outbox as the customer
-- emails (automation_jobs: sent by the API, retried, logged).
--
-- WHO gets it (exactly one person per request, so they can resolve it):
--   1. the accountant already assigned to the customer (customers.accounts_owner_id), if any;
--   2. otherwise the Accounts person on the payment desk: the lowest profiles.payment_desk_order,
--      and when nobody has a number, the longest-serving active Accounts person.
-- With one Accounts person today, they get everything. Later, give one person payment_desk_order = 1
-- (or assign owners) and only that person is emailed. The bell still goes to every Accounts person.
--
-- Requests that send the email:
--   * Sales sends a customer for payment confirmation            (PAYMENT_CONFIRMATION_REQUESTED)
--   * Sales records a payment for Accounts to verify              (PAYMENT_TO_VERIFY)
--   * the Technical Consultant sends add-on services to Accounts  (ADDON_SUBMITTED)
--
-- Additive / re-runnable.
-- =============================================================================

-- 1. Who is on the payment desk
alter table public.profiles add column if not exists payment_desk_order integer check (payment_desk_order >= 1);
comment on column public.profiles.payment_desk_order is
  'Accounts only: who gets the payment-request emails when the customer has no assigned accountant. Lowest number first; empty = longest-serving Accounts person.';

-- The email address that should receive the request about this customer (null: no active Accounts person).
create or replace function private.payment_desk_email(p_customer uuid)
returns table (profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = '' as $$
  with assigned as (
    select p.id, p.email, p.full_name, 0 as rank_a, 0 as rank_b, p.created_at
      from public.customers c
      join public.profiles p on p.id = c.accounts_owner_id
      join public.departments d on d.id = p.department_id and d.slug = 'accounts'
     where c.id = p_customer and p.status = 'ACTIVE'
  ), desk as (
    select p.id, p.email, p.full_name, 1 as rank_a, coalesce(p.payment_desk_order, 1000000) as rank_b, p.created_at
      from public.profiles p
      join public.departments d on d.id = p.department_id and d.slug = 'accounts'
     where p.status = 'ACTIVE'
  )
  select id, email, full_name from (select * from assigned union all select * from desk) x
   order by rank_a, rank_b, created_at, id
   limit 1
$$;
revoke all on function private.payment_desk_email(uuid) from public, anon, authenticated;

-- 2. The outbox: internal jobs (to staff) are not customer messages
alter table public.automation_jobs add column if not exists internal boolean not null default false;
alter table public.automation_jobs drop constraint if exists automation_jobs_stage_check;
alter table public.automation_jobs add constraint automation_jobs_stage_check
  check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED', 'WEBSITE_READY', 'ACCOUNTS_PAYMENT'));

-- Customers' own messages stay visible as before; the staff emails (with an address in them) are not
-- shown on the customer's page.
drop policy if exists automation_jobs_select on public.automation_jobs;
create policy automation_jobs_select on public.automation_jobs for select to authenticated
  using (not internal and (private.can_view_onboarding_review(customer_id) or private.can_view_customer(customer_id)));

-- 3. Queue the email to the payment desk
create or replace function private.queue_accounts_email(p_kind text, p_customer uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v public.customers;
  s record;
begin
  select * into d from private.payment_desk_email(p_customer);
  if d.profile_id is null or d.email is null then
    return; -- nobody to email: the bell notification still went out
  end if;
  select * into v from public.customers where id = p_customer;
  select p.full_name, p.role, dp.name as department into s
    from public.profiles p left join public.departments dp on dp.id = p.department_id where p.id = (select private.my_id());
  insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, internal, context, created_by)
  values (p_customer, 'EMAIL', 'ACCOUNTS_PAYMENT', format('ACCOUNTS|%s|%s|%s', p_kind, p_customer, gen_random_uuid()), true,
          jsonb_strip_nulls(jsonb_build_object(
            'to', d.email, 'toName', d.full_name, 'kind', p_kind, 'title', left(p_title, 200), 'body', left(p_body, 500),
            'customer', coalesce(v.company, v.name), 'contact', v.name, 'phone', v.phone, 'customerEmail', v.email,
            'from', s.full_name, 'fromDepartment', s.department)),
          (select private.my_id()));
end $$;
revoke all on function private.queue_accounts_email(text, uuid, text, text) from public, anon, authenticated;

-- Same bell notification as before (every Accounts person), plus the email to the payment desk.
create or replace function private.notify_accounts(p_type text, p_title text, p_body text, p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
begin
  for v_recipient in
    select p.id from public.profiles p join public.departments d on d.id = p.department_id
    where p.status = 'ACTIVE' and d.slug = 'accounts'
  loop
    perform private.notify(v_recipient, p_type, p_title, p_body, 'customer', p_customer);
  end loop;
  perform private.queue_accounts_email(p_type, p_customer, p_title, p_body);
end $$;
revoke all on function private.notify_accounts(text, text, text, uuid) from public, anon, authenticated;

create or replace function private.notify_accounts_addon(p_type text, p_title text, p_body text, p_entity uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
  v_customer uuid;
begin
  for v_recipient in
    select p.id from public.profiles p join public.departments d on d.id = p.department_id
     where p.status = 'ACTIVE' and d.slug = 'accounts' and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    perform private.notify(v_recipient, p_type, p_title, p_body, 'addon_request', p_entity);
  end loop;
  -- only a request that waits for Accounts is emailed (not every later status update)
  if p_type = 'ADDON_SUBMITTED' then
    select customer_id into v_customer from public.addon_requests where id = p_entity;
    if v_customer is not null then
      perform private.queue_accounts_email(p_type, v_customer, p_title, p_body);
    end if;
  end if;
end $$;
revoke all on function private.notify_accounts_addon(text, text, text, uuid) from public, anon, authenticated;

-- 4. A staff email that could not be sent is the Accounts team's problem, not the customer's: no entry
--    in the customer's activity log, and the failure bell goes to Accounts instead of the Technical Consultants.
create or replace function public.automation_finish_job(
  p_job uuid, p_outcome text, p_detail text default null, p_response_code integer default null,
  p_recipient text default null, p_provider_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.automation_jobs;
  v public.customers;
  v_status text;
  v_recipient uuid;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into j from public.automation_jobs where id = p_job for update;
  if j.id is null or j.status <> 'SENDING' then
    raise exception 'CONFLICT: This job is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and j.attempts >= 5 then 'FAILED'
                   when p_outcome = 'RETRY' then 'QUEUED' else p_outcome end;
  update public.automation_jobs
     set status = v_status,
         detail = left(p_detail, 500),
         response_code = p_response_code,
         recipient = coalesce(left(p_recipient, 254), recipient),
         provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         locked_until = null,
         next_attempt_at = case when v_status = 'QUEUED'
                                then now() + (array[1, 5, 15, 60])[least(j.attempts, 4)] * interval '1 minute'
                                else next_attempt_at end,
         sent_at = case when v_status = 'SENT' then now() else sent_at end,
         secret = case when v_status = 'QUEUED' then secret end
   where id = p_job
  returning * into j;

  if v_status in ('SENT', 'FAILED', 'SKIPPED') then
    select * into v from public.customers where id = j.customer_id;
    if not j.internal then
      perform private.log_customer_activity(j.customer_id, 'AUTOMATION_' || j.channel || '_' || v_status,
        format('%s %s: %s%s', initcap(replace(j.stage, '_', ' ')), case when j.channel = 'EMAIL' then 'email' else 'WhatsApp' end,
               lower(v_status), case when p_detail is not null and v_status <> 'SENT' then ' - ' || left(p_detail, 200) else '' end));
    end if;
    if v_status = 'FAILED' then
      perform private.write_audit('AUTOMATION_FAILED', 'customer', j.customer_id, v.department_id, v.team_id,
        jsonb_build_object('job', j.id, 'channel', j.channel, 'stage', j.stage, 'detail', left(p_detail, 200)));
      if j.internal then
        for v_recipient in
          select p.id from public.profiles p join public.departments d on d.id = p.department_id
           where p.status = 'ACTIVE' and d.slug = 'accounts'
        loop
          perform private.notify(v_recipient, 'AUTOMATION_FAILED', format('Payment email not sent: %s', coalesce(v.company, v.name)),
            format('The email about this payment request could not be sent after %s attempts: %s. The request is still in your queue.', j.attempts, coalesce(left(p_detail, 300), 'unknown error')),
            'customer', j.customer_id, '{}'::jsonb, 'urgent');
        end loop;
      else
        for v_recipient in
          select p.id from public.profiles p join public.teams t on t.id = p.team_id
           where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
             and (p.is_technical_consultant or p.role = 'TEAM_HEAD')
        loop
          perform private.notify(v_recipient, 'AUTOMATION_FAILED',
            format('%s not sent: %s', case when j.channel = 'EMAIL' then 'Email' else 'WhatsApp' end, coalesce(v.company, v.name)),
            format('The %s message could not be sent after %s attempts: %s', initcap(replace(j.stage, '_', ' ')), j.attempts, coalesce(left(p_detail, 300), 'unknown error')),
            'customer', j.customer_id, '{}'::jsonb, 'urgent');
        end loop;
      end if;
    end if;
  end if;
  return jsonb_build_object('id', j.id, 'status', j.status, 'attempts', j.attempts, 'nextAttemptAt', j.next_attempt_at);
end $$;
revoke all on function public.automation_finish_job(uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.automation_finish_job(uuid, text, text, integer, text, text) to service_role;
