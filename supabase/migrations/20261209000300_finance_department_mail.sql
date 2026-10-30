-- =============================================================================
-- E-mail to the responsible Department Head when revenue or an expense is recorded.
--
-- Events (each is a row in public.finance_mail_events, one per RECIPIENT, so every head has a status of their own):
--   PAYMENT_RECORDED   a payment was recorded and is pending verification (never described as collected)
--   PAYMENT_VERIFIED   a payment is verified (recorded and verified in one step also gives only this one)
--   EXPENSE_ADDED      an expense was recorded: one event per department that received an allocation (see migration 20261209000400)
-- Recipients: the ACTIVE Department Heads of the department, read live (role DEPARTMENT_HEAD of that department, plus heads who were given
-- access to it in department_access) with a valid address; nothing is hard-coded. No active head: a NO_RECIPIENT row (visible to Accounts, who can
-- retry once a head exists) and an in-app notice to the Super Admins as the escalation path.
-- Department of a payment = the department its ORDER is attributed to (revenue_attributions, else the revenue rule of the customer's
-- department): an original sale -> Sales, an add-on -> Support, a tagged renewal/add-on invoice -> Support. Not simply the customer's department.
--
-- How it is kept reliable
--   * The e-mail is queued by an AFTER trigger on the payment tables, in the same transaction as the payment, as plain rows: no network call is
--     made inside a financial transaction, and a failure to queue never rolls the payment back (it is caught and reported as a warning).
--   * One row per (event, recipient): a retried request or a repeated trigger cannot queue it twice.
--   * The server sends them (server/automations/financeDispatcher.ts) through the existing mail setup: claimed with SKIP LOCKED, bounded retries
--     (1, 5, 15, 60 minutes, then FAILED), a per-recipient status, a retry for Accounts, a notice to Accounts when one finally fails.
--   * What is in the e-mail: customer, reference, services, department, amount, status, time, a link to the dashboard. No payment reference, no
--     bank detail, no customer phone / e-mail. An expense mail carries ONLY that department's allocated amount.
-- Payments imported from older records (source LEGACY) send nothing. Safe to run again. Nothing is sent by running it.
-- =============================================================================

create table if not exists public.finance_mail_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (length(dedupe_key) <= 300),
  kind text not null check (kind in ('PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'EXPENSE_ADDED')),
  event_token text not null,                       -- the payment / expense this is about (to find all recipients of one event)
  department_id uuid not null references public.departments (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  recipient_id uuid references public.profiles (id) on delete set null,
  recipient_email text check (length(recipient_email) <= 254),
  recipient_name text check (length(recipient_name) <= 200),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 4096),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'NO_RECIPIENT', 'CANCELLED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  detail text check (length(detail) <= 500),
  response_code integer,
  provider_ref text check (length(provider_ref) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists finance_mail_events_due_idx on public.finance_mail_events (next_attempt_at) where status in ('QUEUED', 'SENDING');
create index if not exists finance_mail_events_department_idx on public.finance_mail_events (department_id, created_at desc);
create index if not exists finance_mail_events_token_idx on public.finance_mail_events (event_token);
alter table public.finance_mail_events enable row level security;
revoke all on public.finance_mail_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who is the Department Head of a department (live)
-- ---------------------------------------------------------------------------
create or replace function private.department_head_recipients(p_department uuid, p_division text default null)
returns table (profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct on (lower(p.email)) p.id, lower(p.email), p.full_name
    from public.profiles p
   where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
     and (p.department_id = p_department
          or exists (select 1 from public.department_access a where a.profile_id = p.id and a.department_id = p_department
                      and (p_division is null or a.division = p_division)))
     -- a department can have a Sales head and a Support head: a Sales order's e-mail goes to the Sales side (and to a head who has no side).
     -- A head given access to ANOTHER department receives for the side the access was given for.
     and (p_division is null or p.head_division is null or p.head_division = p_division or p.department_id <> p_department)
     and p.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
   order by lower(p.email), p.created_at
$$;
revoke all on function private.department_head_recipients(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queue one event for a department: one row per head, or a NO_RECIPIENT row and a notice to the Super Admins
-- ---------------------------------------------------------------------------
create or replace function private.finance_mail_queue(p_kind text, p_department uuid, p_customer uuid, p_token text, p_payload jsonb, p_division text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
  v_inserted boolean;
  v_name text;
  sa uuid;
begin
  if p_department is null then
    return 0;
  end if;
  for r in select * from private.department_head_recipients(p_department, p_division) loop
    insert into public.finance_mail_events (dedupe_key, kind, event_token, department_id, customer_id, recipient_id, recipient_email, recipient_name, payload, created_by)
    values (format('FIN|%s|%s|%s|%s', p_kind, p_token, p_department, r.profile_id), p_kind, p_token, p_department, p_customer, r.profile_id, r.email, r.full_name, p_payload, (select private.my_id()))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted then n := n + 1; end if;
  end loop;
  if n = 0 and not exists (select 1 from public.finance_mail_events e where e.kind = p_kind and e.event_token = p_token and e.department_id = p_department and e.status <> 'NO_RECIPIENT') then
    insert into public.finance_mail_events (dedupe_key, kind, event_token, department_id, customer_id, payload, status, detail, created_by)
    values (format('FIN|%s|%s|%s|NONE', p_kind, p_token, p_department), p_kind, p_token, p_department, p_customer, p_payload, 'NO_RECIPIENT',
            'The department has no active Department Head with a valid e-mail address. Nothing was sent.', (select private.my_id()))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted then
      select name into v_name from public.departments where id = p_department;
      for sa in select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE' loop
        perform private.notify(sa, 'FINANCE_MAIL_NO_RECIPIENT', format('No Department Head to e-mail: %s', coalesce(v_name, 'a department')),
          'A payment or expense was recorded for this department, but it has no active Department Head with a valid e-mail address. Assign one; Accounts can then send the e-mail again.',
          'department', p_department, '{}'::jsonb, 'urgent');
      end loop;
    end if;
  end if;
  return n;
end $$;
revoke all on function private.finance_mail_queue(text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Which department earns a payment (the same rule the income reports use), and a plain description of it
-- ---------------------------------------------------------------------------
create or replace function private.payment_mail_context(p_source text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid; v_amount numeric; v_status text; v_type text; v_department uuid; v_ref text; v_services text; v_division text;
  c public.customers;
begin
  if p_source = 'CP' then
    select customer_id, amount, status, payment_type into v_customer, v_amount, v_status, v_type from public.customer_payments where id = p_id;
    select * into c from public.customers where id = v_customer;
    select a.department_id, a.division into v_department, v_division from public.revenue_attributions a where a.order_key = 'SALE:' || v_customer::text;
    v_department := coalesce(v_department, private.revenue_department(c.department_id, 'SALES'));
    v_division := coalesce(v_division, 'SALES');
    v_ref := 'Order of ' || coalesce(c.customer_code, 'the customer');
    select string_agg(s.name, ', ' order by s.sort_order) into v_services
      from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = v_customer;
  elsif p_source = 'AP' then
    select p.customer_id, p.amount, p.status, 'ADDON', p.request_id into v_customer, v_amount, v_status, v_type, p_id from public.addon_payments p where p.id = p_id;
    select * into c from public.customers where id = v_customer;
    select a.department_id, a.division into v_department, v_division from public.revenue_attributions a where a.order_key = 'ADDON:' || p_id::text;
    v_department := coalesce(v_department, private.revenue_department(c.department_id, 'SUPPORT'));
    v_division := coalesce(v_division, 'SUPPORT');
    v_ref := 'Add-on of ' || coalesce(c.customer_code, 'the customer');
    select string_agg(i.name, ', ' order by i.sort_order) into v_services from public.addon_request_items i where i.request_id = p_id;
  else
    select ip.customer_id, ip.amount, ip.status, ip.payment_type, ip.invoice_id into v_customer, v_amount, v_status, v_type, p_id from public.invoice_payments ip where ip.id = p_id;
    select * into c from public.customers where id = v_customer;
    select m.invoice_number into v_ref from public.member_invoices m where m.id = p_id;
    v_ref := 'Invoice ' || coalesce(v_ref, '');
    select a.department_id, a.division into v_department, v_division from public.revenue_attributions a where a.order_key = 'INV:' || p_id::text;
    v_division := coalesce(v_division, case when exists (select 1 from public.generated_invoices g where g.invoice_id = p_id and g.purpose = 'SERVICES') then 'SALES' else 'SUPPORT' end);
    v_department := coalesce(v_department, private.revenue_department(c.department_id, v_division));
    select coalesce(s.name, 'Invoice payment') into v_services from public.invoice_business_tags t left join public.crm_services s on s.code = t.service_code where t.invoice_id = p_id;
  end if;
  return jsonb_build_object('customerId', v_customer, 'departmentId', v_department, 'division', v_division, 'status', v_status, 'amount', v_amount,
    'payload', jsonb_build_object('customer', coalesce(nullif(btrim(c.company), ''), c.name), 'customerCode', c.customer_code, 'orderRef', v_ref,
      'services', v_services, 'amount', v_amount, 'paymentType', v_type));
end $$;
revoke all on function private.payment_mail_context(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The triggers: a payment is recorded (pending), verified, or recorded already verified
-- ---------------------------------------------------------------------------
create or replace function private.tg_finance_payment_mail()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_src text := case tg_table_name when 'customer_payments' then 'CP' when 'addon_payments' then 'AP' else 'IP' end;
  v_kind text;
  v_ctx jsonb;
  v_dept text;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'VERIFIED' then v_kind := 'PAYMENT_VERIFIED';
      elsif new.status = 'PENDING' then v_kind := 'PAYMENT_RECORDED';
      end if;
    elsif old.status is distinct from 'VERIFIED' and new.status = 'VERIFIED' then
      v_kind := 'PAYMENT_VERIFIED';
    end if;
    if v_kind is null then return new; end if;
    if v_src = 'CP' and to_jsonb(new) ->> 'source' = 'LEGACY' then return new; end if;   -- records brought in from older systems send nothing
    v_ctx := private.payment_mail_context(v_src, new.id);
    if (v_ctx ->> 'departmentId') is null then return new; end if;
    select name into v_dept from public.departments where id = (v_ctx ->> 'departmentId')::uuid;
    perform private.finance_mail_queue(v_kind, (v_ctx ->> 'departmentId')::uuid, (v_ctx ->> 'customerId')::uuid, v_src || ':' || new.id::text,
      (v_ctx -> 'payload') || jsonb_build_object('department', v_dept, 'at', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'),
        'verifiedAmount', case when v_kind = 'PAYMENT_VERIFIED' then new.amount end,
        'status', case when v_kind = 'PAYMENT_VERIFIED' then 'VERIFIED' else 'PENDING_VERIFICATION' end, 'division', v_ctx ->> 'division'),
      v_ctx ->> 'division');
  exception when others then
    -- the payment is the business record: telling someone about it must never undo it
    raise warning 'finance e-mail could not be queued for % %: %', tg_table_name, new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function private.tg_finance_payment_mail() from public, anon, authenticated;

drop trigger if exists customer_payments_finance_mail on public.customer_payments;
create trigger customer_payments_finance_mail after insert or update of status on public.customer_payments for each row execute function private.tg_finance_payment_mail();
drop trigger if exists addon_payments_finance_mail on public.addon_payments;
create trigger addon_payments_finance_mail after insert or update of status on public.addon_payments for each row execute function private.tg_finance_payment_mail();
drop trigger if exists invoice_payments_finance_mail on public.invoice_payments;
create trigger invoice_payments_finance_mail after insert or update of status on public.invoice_payments for each row execute function private.tg_finance_payment_mail();

-- ---------------------------------------------------------------------------
-- The sender (service role): claim, finish
-- ---------------------------------------------------------------------------
create or replace function public.finance_mail_claim(p_limit integer default 10, p_mode text default 'live', p_lease_seconds integer default 600, p_only_recipients text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    select e.id from public.finance_mail_events e
     where ((e.status = 'QUEUED' and e.next_attempt_at <= now()) or (e.status = 'SENDING' and e.locked_until < now()))
       and (p_only_recipients is null or lower(e.recipient_email) = any (p_only_recipients))
     order by e.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;
  update public.finance_mail_events
     set status = 'SENDING', attempts = attempts + 1, locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 1800))), updated_at = now()
   where id = any (v_ids);
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'attempts', e.attempts, 'to', e.recipient_email, 'toName', e.recipient_name,
                     'payload', e.payload) order by e.next_attempt_at)
                     from public.finance_mail_events e where e.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.finance_mail_claim(integer, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.finance_mail_claim(integer, text, integer, text[]) to service_role;

create or replace function public.finance_mail_finish(p_event uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_provider_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.finance_mail_events;
  v_status text;
  v_acc uuid;
  v_dept text;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into e from public.finance_mail_events where id = p_event for update;
  if e.id is null or e.status <> 'SENDING' then
    raise exception 'CONFLICT: This e-mail is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and e.attempts >= 5 then 'FAILED' when p_outcome = 'RETRY' then 'QUEUED' else p_outcome end;
  update public.finance_mail_events
     set status = v_status, detail = left(p_detail, 500), response_code = p_response_code, provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         locked_until = null, updated_at = now(),
         next_attempt_at = case when v_status = 'QUEUED' then now() + (array[1, 5, 15, 60])[least(greatest(e.attempts, 1), 4)] * interval '1 minute' else next_attempt_at end,
         sent_at = case when v_status = 'SENT' then now() else sent_at end
   where id = p_event returning * into e;
  if v_status = 'FAILED' then
    select name into v_dept from public.departments where id = e.department_id;
    for v_acc in select p.id from public.profiles p join public.departments d on d.id = p.department_id where p.status = 'ACTIVE' and d.slug = 'accounts' loop
      perform private.notify(v_acc, 'AUTOMATION_FAILED', format('Department e-mail not sent: %s', coalesce(v_dept, 'a department')),
        format('The e-mail about a %s to the Department Head could not be sent after %s attempts: %s. Open Finance e-mails and send it again.',
               case e.kind when 'EXPENSE_ADDED' then 'new expense' else 'payment' end, e.attempts, coalesce(left(p_detail, 300), 'unknown error')),
        'department', e.department_id, '{}'::jsonb, 'urgent');
    end loop;
  end if;
  return jsonb_build_object('id', e.id, 'status', e.status);
end $$;
revoke all on function public.finance_mail_finish(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.finance_mail_finish(uuid, text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- Accounts: see the status of every e-mail, and send a failed / unsent one again
-- ---------------------------------------------------------------------------
create or replace function public.accounts_finance_mail_list(p_status text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  if p_status is not null and p_status not in ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'NO_RECIPIENT', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.finance_mail_events group by status) x),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'status', e.status, 'detail', e.detail, 'attempts', e.attempts, 'department', d.name, 'departmentId', e.department_id,
        'recipient', e.recipient_name, 'to', e.recipient_email, 'sentAt', e.sent_at, 'createdAt', e.created_at,
        'customer', e.payload ->> 'customer', 'amount', case when e.kind = 'EXPENSE_ADDED' then e.payload -> 'allocated' else e.payload -> 'amount' end,
        'canRetry', e.status in ('FAILED', 'SKIPPED', 'NO_RECIPIENT')) order by e.created_at desc)
        from (select * from public.finance_mail_events x where p_status is null or x.status = p_status order by x.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) e
        join public.departments d on d.id = e.department_id), '[]'::jsonb));
end $$;
revoke all on function public.accounts_finance_mail_list(text, integer) from public, anon;
grant execute on function public.accounts_finance_mail_list(text, integer) to authenticated;

create or replace function public.accounts_finance_mail_retry(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.finance_mail_events;
  n integer;
begin
  perform private.require_accounts_staff();
  select * into e from public.finance_mail_events where id = p_event for update;
  if e.id is null then
    raise exception 'NOT_FOUND: E-mail not found.' using errcode = 'P0001';
  end if;
  if e.status = 'NO_RECIPIENT' then
    -- look for a Department Head again; this row is closed once there is one
    n := private.finance_mail_queue(e.kind, e.department_id, e.customer_id, e.event_token || '#retry', e.payload, e.payload ->> 'division');
    if n = 0 then
      raise exception 'CONFLICT: The department still has no active Department Head with a valid e-mail address.' using errcode = 'P0001';
    end if;
    update public.finance_mail_events set status = 'CANCELLED', detail = 'A Department Head was found; the e-mail was queued again.', updated_at = now() where id = e.id;
    return jsonb_build_object('queued', n);
  elsif e.status in ('FAILED', 'SKIPPED') then
    update public.finance_mail_events set status = 'QUEUED', attempts = 0, next_attempt_at = now(), locked_until = null, detail = null, updated_at = now() where id = e.id;
    return jsonb_build_object('queued', 1);
  end if;
  raise exception 'CONFLICT: Only a failed, unsent or recipient-less e-mail can be sent again.' using errcode = 'P0001';
end $$;
revoke all on function public.accounts_finance_mail_retry(uuid) from public, anon;
grant execute on function public.accounts_finance_mail_retry(uuid) to authenticated;

notify pgrst, 'reload schema';
