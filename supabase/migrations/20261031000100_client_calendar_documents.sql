-- =============================================================================
-- Client dashboard: Calendar and Documents.
--
--  1. Calendar. The support team logs what was done for a client on a date (a campaign, a post, a call
--     campaign ...) with its insights (reach, leads, messages sent ...). The client sees it on a calendar,
--     together with what the system already knows: services started / activated / renewing, invoices issued
--     and paid, tickets, documents verified.
--  2. Documents. The client can upload a document (or fill in a detail) they missed during onboarding, and
--     the documents of a service they buy later, from their own dashboard. An upload is a normal onboarding
--     entry (status SAVED), so everything that already reads the checklist sees it. The Technical Consultant
--     (the department's support team) verifies it or sends it back with a note; the client is told either way.
--
-- A client works only through client_* functions that take no customer id (the customer comes from the login).
-- Staff use the other functions below. Nothing in here changes what Sales or the Technical Consultant do
-- during onboarding. Safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Small extensions
-- ---------------------------------------------------------------------------
alter table public.client_notifications drop constraint if exists client_notifications_entity_type_check;
alter table public.client_notifications add constraint client_notifications_entity_type_check
  check (entity_type in ('invoice', 'service', 'plan', 'ticket', 'service_request', 'plan_request', 'addon', 'announcement', 'calendar', 'document'));

-- Which entries the client saved themselves (the review queue). Reset whenever staff save the item.
alter table public.customer_onboarding_entries add column if not exists saved_by_client boolean not null default false;
create index if not exists customer_onboarding_entries_client_idx on public.customer_onboarding_entries (customer_id, status) where saved_by_client;

create or replace function private.tg_entries_client_flag()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.saved_by is not null then
    new.saved_by_client := false;
  end if;
  return new;
end $$;
drop trigger if exists customer_onboarding_entries_client_flag on public.customer_onboarding_entries;
create trigger customer_onboarding_entries_client_flag before insert or update on public.customer_onboarding_entries
  for each row execute function private.tg_entries_client_flag();

-- ---------------------------------------------------------------------------
-- 1. Who serves a client (logs their activity, verifies what they upload)
-- ---------------------------------------------------------------------------
-- The Super Admin, the Department Head of the customer's department, the support team of that department
-- (Technical Consultants and their team leads), the team lead / team member the customer was handed over to,
-- and the department that delivers one of the customer's services (for example the Design Studio).
create or replace function private.can_serve_client(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_super_admin()
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()
        or exists (select 1 from public.customer_onboarding o
                    where o.customer_id = c.id and (o.team_member_id = (select private.my_id()) or o.team_lead_id = (select private.my_id())))
        or exists (select 1 from public.customer_services s join public.profiles p on p.id = (select private.my_id()) and p.status = 'ACTIVE'
                    where s.customer_id = c.id and s.delivery_department_id is not null and s.delivery_department_id = p.department_id)
      from public.customers c where c.id = p_customer), false)
$$;
revoke all on function private.can_serve_client(uuid) from public, anon;
grant execute on function private.can_serve_client(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Calendar: what the team did, with its insights
-- ---------------------------------------------------------------------------
create table if not exists public.client_calendar_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text references public.crm_services (code) on delete set null,
  event_date date not null,
  kind text not null default 'OTHER'
    check (kind in ('CAMPAIGN', 'CALL_CAMPAIGN', 'POST', 'AD', 'SETUP', 'REPORT', 'MEETING', 'OTHER')),
  title text not null check (length(title) between 3 and 160),
  summary text check (length(summary) <= 2000),
  -- insights: [{"label": "Messages sent", "value": "4,200"}, ...]
  metrics jsonb not null default '[]'::jsonb check (jsonb_typeof(metrics) = 'array' and jsonb_array_length(metrics) <= 12),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_calendar_events_customer_idx on public.client_calendar_events (customer_id, event_date);
alter table public.client_calendar_events enable row level security;
revoke all on public.client_calendar_events from public, anon, authenticated;

-- Insights are a short list of label / value pairs, cleaned up here (blank rows dropped).
create or replace function private.clean_metrics(p_metrics jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v jsonb;
  m jsonb := '[]'::jsonb;
  l text;
  x text;
begin
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'array' then
    return '[]'::jsonb;
  end if;
  for v in select * from jsonb_array_elements(p_metrics) loop
    if jsonb_typeof(v) <> 'object' then
      raise exception 'VALIDATION_ERROR: Each insight needs a name and a value.' using errcode = 'P0001';
    end if;
    l := nullif(trim(coalesce(v ->> 'label', '')), '');
    x := nullif(trim(coalesce(v ->> 'value', '')), '');
    if l is null and x is null then
      continue;
    end if;
    if l is null or x is null then
      raise exception 'VALIDATION_ERROR: Each insight needs both a name and a value.' using errcode = 'P0001';
    end if;
    if length(l) > 60 or length(x) > 60 then
      raise exception 'VALIDATION_ERROR: Keep each insight name and value under 60 characters.' using errcode = 'P0001';
    end if;
    m := m || jsonb_build_array(jsonb_build_object('label', l, 'value', x));
  end loop;
  if jsonb_array_length(m) > 12 then
    raise exception 'VALIDATION_ERROR: Add at most 12 insights.' using errcode = 'P0001';
  end if;
  return m;
end $$;
revoke all on function private.clean_metrics(jsonb) from public, anon, authenticated;

create or replace function private.calendar_event_json(e public.client_calendar_events)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'source', 'ACTIVITY', 'date', e.event_date, 'kind', e.kind, 'title', e.title,
    'summary', e.summary, 'serviceCode', e.service_code,
    'serviceName', (select s.name from public.crm_services s where s.code = e.service_code),
    'metrics', e.metrics, 'createdBy', (select p.full_name from public.profiles p where p.id = e.created_by), 'createdAt', e.created_at)
$$;
revoke all on function private.calendar_event_json(public.client_calendar_events) from public, anon, authenticated;

-- Staff: log what was done for a client. Allowed dates: up to a year back or ahead.
create or replace function public.log_client_activity(
  p_customer uuid, p_service text, p_date date, p_kind text, p_title text, p_summary text, p_metrics jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  e public.client_calendar_events;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_summary text := nullif(trim(coalesce(p_summary, '')), '');
  v_service text := nullif(trim(coalesce(p_service, '')), '');
begin
  if not private.can_serve_client(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  if p_date is null or p_date < private.office_today() - 366 or p_date > private.office_today() + 366 then
    raise exception 'VALIDATION_ERROR: Choose a date within a year of today.' using errcode = 'P0001';
  end if;
  if v_title is null or length(v_title) < 3 or length(v_title) > 160 then
    raise exception 'VALIDATION_ERROR: Enter a title (3 to 160 characters).' using errcode = 'P0001';
  end if;
  if v_summary is not null and length(v_summary) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the details under 2000 characters.' using errcode = 'P0001';
  end if;
  if coalesce(p_kind, 'OTHER') not in ('CAMPAIGN', 'CALL_CAMPAIGN', 'POST', 'AD', 'SETUP', 'REPORT', 'MEETING', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose what kind of activity this is.' using errcode = 'P0001';
  end if;
  if v_service is not null and not exists (select 1 from public.customer_services s where s.customer_id = p_customer and s.service_code = v_service) then
    raise exception 'VALIDATION_ERROR: Choose one of the customer''s services.' using errcode = 'P0001';
  end if;
  insert into public.client_calendar_events (customer_id, service_code, event_date, kind, title, summary, metrics, created_by)
  values (p_customer, v_service, p_date, coalesce(p_kind, 'OTHER'), v_title, v_summary, private.clean_metrics(p_metrics), (select private.my_id()))
  returning * into e;
  perform private.client_notify(p_customer, 'ACTIVITY_LOGGED', format('Update: %s', e.title),
    case when e.event_date > private.office_today() then format('Planned for %s. Open Calendar for the details.', to_char(e.event_date, 'DD Mon YYYY'))
         else format('Done on %s. Open Calendar to see the details and insights.', to_char(e.event_date, 'DD Mon YYYY')) end,
    'calendar', e.id, format('CAL|%s', e.id));
  perform private.log_customer_activity(p_customer, 'CLIENT_ACTIVITY_LOGGED', format('%s (%s)', e.title, to_char(e.event_date, 'DD Mon YYYY')));
  perform private.write_audit('CLIENT_ACTIVITY_LOGGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('event', e.id, 'date', e.event_date, 'kind', e.kind));
  return private.calendar_event_json(e);
end $$;
revoke all on function public.log_client_activity(uuid, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.log_client_activity(uuid, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.update_client_activity(
  p_id uuid, p_service text, p_date date, p_kind text, p_title text, p_summary text, p_metrics jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.client_calendar_events;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_summary text := nullif(trim(coalesce(p_summary, '')), '');
  v_service text := nullif(trim(coalesce(p_service, '')), '');
begin
  select * into e from public.client_calendar_events where id = p_id for update;
  if e.id is null or not private.can_serve_client(e.customer_id) then
    raise exception 'NOT_FOUND: Activity not found.' using errcode = 'P0001';
  end if;
  if p_date is null or p_date < private.office_today() - 366 or p_date > private.office_today() + 366 then
    raise exception 'VALIDATION_ERROR: Choose a date within a year of today.' using errcode = 'P0001';
  end if;
  if v_title is null or length(v_title) < 3 or length(v_title) > 160 then
    raise exception 'VALIDATION_ERROR: Enter a title (3 to 160 characters).' using errcode = 'P0001';
  end if;
  if v_summary is not null and length(v_summary) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the details under 2000 characters.' using errcode = 'P0001';
  end if;
  if coalesce(p_kind, 'OTHER') not in ('CAMPAIGN', 'CALL_CAMPAIGN', 'POST', 'AD', 'SETUP', 'REPORT', 'MEETING', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose what kind of activity this is.' using errcode = 'P0001';
  end if;
  if v_service is not null and not exists (select 1 from public.customer_services s where s.customer_id = e.customer_id and s.service_code = v_service) then
    raise exception 'VALIDATION_ERROR: Choose one of the customer''s services.' using errcode = 'P0001';
  end if;
  update public.client_calendar_events
     set service_code = v_service, event_date = p_date, kind = coalesce(p_kind, 'OTHER'), title = v_title, summary = v_summary,
         metrics = private.clean_metrics(p_metrics), updated_at = now()
   where id = p_id returning * into e;
  return private.calendar_event_json(e);
end $$;
revoke all on function public.update_client_activity(uuid, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.update_client_activity(uuid, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.delete_client_activity(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.client_calendar_events;
begin
  select * into e from public.client_calendar_events where id = p_id for update;
  if e.id is null or not private.can_serve_client(e.customer_id) then
    raise exception 'NOT_FOUND: Activity not found.' using errcode = 'P0001';
  end if;
  delete from public.client_calendar_events where id = p_id;
  -- the client's bell entry for it points at nothing now
  delete from public.client_notifications where dedupe_key = format('CAL|%s', p_id);
end $$;
revoke all on function public.delete_client_activity(uuid) from public, anon;
grant execute on function public.delete_client_activity(uuid) to authenticated;

-- Staff: everything logged for one customer, newest first (plus the customer's services to choose from).
create or replace function public.client_activity_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_serve_client(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'hasClientLogin', exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer),
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order, s.name)
                            from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                           where cs.customer_id = p_customer), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(private.calendar_event_json(e) order by e.event_date desc, e.created_at desc)
                          from public.client_calendar_events e where e.customer_id = p_customer), '[]'::jsonb));
end $$;
revoke all on function public.client_activity_list(uuid) from public, anon;
grant execute on function public.client_activity_list(uuid) to authenticated;

-- Client: the calendar between two dates (at most 400 days): what the team did, and what the system recorded.
create or replace function public.client_calendar(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'VALIDATION_ERROR: Choose a valid date range.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.d desc, x.ord, x.j ->> 'title')
    from (
      -- 1. what the team did (with insights)
      select e.event_date as d, 1 as ord, private.calendar_event_json(e) as j
        from public.client_calendar_events e
       where e.customer_id = v_customer and e.event_date between p_from and p_to
      union all
      -- 2. services: started, activated, renewing
      select (cs.created_at at time zone 'Asia/Kolkata')::date, 2,
             jsonb_build_object('id', format('svc-start-%s', cs.service_code), 'source', 'SERVICE', 'kind', 'SERVICE_STARTED',
               'date', (cs.created_at at time zone 'Asia/Kolkata')::date, 'title', format('%s added to your account', s.name),
               'serviceCode', s.code, 'serviceName', s.name, 'metrics', '[]'::jsonb)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = v_customer and (cs.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      union all
      select (cs.activated_at at time zone 'Asia/Kolkata')::date, 2,
             jsonb_build_object('id', format('svc-live-%s', cs.service_code), 'source', 'SERVICE', 'kind', 'SERVICE_ACTIVATED',
               'date', (cs.activated_at at time zone 'Asia/Kolkata')::date, 'title', format('%s is live', s.name),
               'serviceCode', s.code, 'serviceName', s.name, 'metrics', '[]'::jsonb)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = v_customer and cs.activated_at is not null
         and (cs.activated_at at time zone 'Asia/Kolkata')::date between p_from and p_to
         and (cs.activated_at at time zone 'Asia/Kolkata')::date <> (cs.created_at at time zone 'Asia/Kolkata')::date
      union all
      select cs.renews_on, 2,
             jsonb_build_object('id', format('svc-renew-%s', cs.service_code), 'source', 'SERVICE', 'kind', 'SERVICE_RENEWAL',
               'date', cs.renews_on, 'title', format('%s renews', s.name), 'serviceCode', s.code, 'serviceName', s.name, 'metrics', '[]'::jsonb)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = v_customer and cs.renews_on between p_from and p_to
      union all
      -- 3. invoices: issued, paid
      select (coalesce(i.issued_at, i.created_at) at time zone 'Asia/Kolkata')::date, 3,
             jsonb_build_object('id', format('inv-%s', i.id), 'source', 'INVOICE', 'kind', 'INVOICE_ISSUED',
               'date', (coalesce(i.issued_at, i.created_at) at time zone 'Asia/Kolkata')::date,
               'title', format('Invoice %s issued', i.invoice_number), 'summary', format('Amount: Rs. %s', to_char(i.amount, 'FM99,99,99,99,990')),
               'metrics', '[]'::jsonb)
        from public.member_invoices i left join public.generated_invoices g on g.invoice_id = i.id
       where i.customer_id = v_customer and i.kind <> 'MANUAL'
         and (g.invoice_id is null or g.unpaid_pdf_status = 'STORED' or g.paid_pdf_status = 'STORED')
         and (coalesce(i.issued_at, i.created_at) at time zone 'Asia/Kolkata')::date between p_from and p_to
      union all
      select (i.paid_at at time zone 'Asia/Kolkata')::date, 3,
             jsonb_build_object('id', format('pay-%s', i.id), 'source', 'INVOICE', 'kind', 'INVOICE_PAID',
               'date', (i.paid_at at time zone 'Asia/Kolkata')::date, 'title', format('Payment confirmed for invoice %s', i.invoice_number),
               'summary', format('Amount: Rs. %s', to_char(i.amount, 'FM99,99,99,99,990')), 'metrics', '[]'::jsonb)
        from public.member_invoices i left join public.generated_invoices g on g.invoice_id = i.id
       where i.customer_id = v_customer and i.kind <> 'MANUAL' and i.status = 'Paid' and i.paid_at is not null
         and (g.invoice_id is null or g.unpaid_pdf_status = 'STORED' or g.paid_pdf_status = 'STORED')
         and (i.paid_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      union all
      -- 4. tickets
      select (t.created_at at time zone 'Asia/Kolkata')::date, 4,
             jsonb_build_object('id', format('tkt-%s', t.id), 'source', 'TICKET', 'kind', 'TICKET_RAISED',
               'date', (t.created_at at time zone 'Asia/Kolkata')::date, 'title', format('You raised ticket %s: %s', t.ticket_no, t.subject),
               'serviceCode', t.service_code, 'metrics', '[]'::jsonb)
        from public.support_tickets t
       where t.customer_id = v_customer and (t.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      union all
      select (t.updated_at at time zone 'Asia/Kolkata')::date, 4,
             jsonb_build_object('id', format('tkt-done-%s', t.id), 'source', 'TICKET', 'kind', 'TICKET_RESOLVED',
               'date', (t.updated_at at time zone 'Asia/Kolkata')::date, 'title', format('Ticket %s was resolved', t.ticket_no),
               'summary', t.subject, 'metrics', '[]'::jsonb)
        from public.support_tickets t
       where t.customer_id = v_customer and t.status in ('RESOLVED', 'CLOSED')
         and (t.updated_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      union all
      -- 5. documents the team verified
      select (en.reviewed_at at time zone 'Asia/Kolkata')::date, 5,
             jsonb_build_object('id', format('doc-%s', en.item_code), 'source', 'DOCUMENT', 'kind', 'DOCUMENT_VERIFIED',
               'date', (en.reviewed_at at time zone 'Asia/Kolkata')::date, 'title', format('%s was verified', oi.label), 'metrics', '[]'::jsonb)
        from public.customer_onboarding_entries en join public.onboarding_items oi on oi.code = en.item_code
       where en.customer_id = v_customer and en.status = 'VERIFIED' and en.reviewed_at is not null and en.item_code <> 'INVOICE'
         and (en.reviewed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    ) x), '[]'::jsonb);
end $$;
revoke all on function public.client_calendar(date, date) from public, anon;
grant execute on function public.client_calendar(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Documents: what the client may fill in, and the upload
-- ---------------------------------------------------------------------------
-- The items a client can provide: documents and typed details of their own services (and of paid add-ons).
-- Consultant-only items, approvals, access grants and amounts stay with the team; the invoice is Accounts'.
create or replace function private.client_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select x.* from (
    select distinct on (u.code) u.* from (
      select * from private.customer_items(p_customer)
      union all select * from private.customer_optional_items(p_customer)
      union all select * from private.customer_addon_items(p_customer)
    ) u order by u.code) x
   where x.code <> 'INVOICE' and x.filled_by = 'SALES' and x.kind in ('FILE', 'DETAILS', 'CHOICE')
$$;
revoke all on function private.client_items(uuid) from public, anon, authenticated;

create or replace function public.client_documents()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_codes text[];
  v_items jsonb;
begin
  v_codes := coalesce((select array_agg(cs.service_code) from public.customer_services cs where cs.customer_id = v_customer), '{}'::text[])
          || private.customer_addon_codes(v_customer);
  select coalesce(jsonb_agg(j order by (j ->> 'sortOrder')::int), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'code', i.code, 'label', i.label, 'hint', i.hint, 'kind', i.kind, 'options', i.options, 'optional', i.is_optional,
      'section', i.section, 'sortOrder', i.sort_order,
      'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order)
                              from public.onboarding_item_services m join public.crm_services s on s.code = m.service_code
                             where m.item_code = i.code and m.service_code = any (v_codes)), '[]'::jsonb),
      'status', case when e.item_code is null then 'MISSING' else e.status end,
      'value', e.value, 'documentId', e.document_id, 'savedAt', e.saved_at, 'byClient', coalesce(e.saved_by_client, false),
      'reviewedAt', e.reviewed_at, 'reviewNote', case when e.status = 'REJECTED' then e.review_note end,
      'canEdit', coalesce(e.status, '') <> 'VERIFIED',
      'allowedMimeTypes', t.allowed_mime_types, 'maxSizeBytes', t.max_size_bytes) as j
    from private.client_items(v_customer) i
    left join public.customer_onboarding_entries e on e.customer_id = v_customer and e.item_code = i.code
    left join public.document_types t on t.code = i.code and i.kind = 'FILE'
  ) q;
  return jsonb_build_object(
    'items', v_items,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_items),
      'provided', (select count(*) from jsonb_array_elements(v_items) x where x ->> 'status' in ('SAVED', 'VERIFIED')),
      'verified', (select count(*) from jsonb_array_elements(v_items) x where x ->> 'status' = 'VERIFIED'),
      'needed', (select count(*) from jsonb_array_elements(v_items) x where x ->> 'status' in ('MISSING', 'REJECTED') and not (x ->> 'optional')::boolean)));
end $$;
revoke all on function public.client_documents() from public, anon;
grant execute on function public.client_documents() to authenticated;

-- Start an upload of one document of the client's own checklist. The file itself goes straight to storage
-- (see the API); this row is the booking, created PENDING.
create or replace function public.client_begin_document_upload(p_item text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  i public.onboarding_items;
  t public.document_types;
  e public.customer_onboarding_entries;
  d public.customer_documents;
  v_id uuid := gen_random_uuid();
  v_ext text;
begin
  select * into i from private.client_items(v_customer) x where x.code = p_item and x.kind = 'FILE';
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This document is not part of your onboarding.' using errcode = 'P0001';
  end if;
  select * into e from public.customer_onboarding_entries where customer_id = v_customer and item_code = p_item;
  if e.status = 'VERIFIED' then
    raise exception 'CONFLICT: This document was already verified by our team. Raise a ticket if it has to change.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = p_item;
  if t.code is null then
    raise exception 'VALIDATION_ERROR: Unknown document type.' using errcode = 'P0001';
  end if;
  if p_mime is null or not (p_mime = any (t.allowed_mime_types)) then
    raise exception 'VALIDATION_ERROR: This file type is not accepted for %.', t.label using errcode = 'P0001';
  end if;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File must be smaller than %.',
      case when t.max_size_bytes < 1048576 then (t.max_size_bytes / 1024) || ' KB' else (t.max_size_bytes / 1048576) || ' MB' end using errcode = 'P0001';
  end if;
  -- a client cannot park piles of unfinished uploads
  if (select count(*) from public.customer_documents x
       where x.customer_id = v_customer and x.status = 'PENDING' and x.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'CONFLICT: Too many uploads were started. Please wait a little and try again.' using errcode = 'P0001';
  end if;
  v_ext := case p_mime
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'text/csv' then 'csv' when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' when 'audio/mp4' then 'm4a' else 'bin' end;
  insert into public.customer_documents (id, customer_id, document_type, version, status, storage_path,
                                         original_file_name, mime_type, size_bytes, uploaded_by)
  values (v_id, v_customer, p_item, null, 'PENDING',
          format('customers/%s/%s/%s.%s', v_customer, t.storage_folder, v_id, v_ext),
          left(regexp_replace(coalesce(nullif(trim(p_file_name), ''), 'document.' || v_ext), '[\r\n\t/\\]', '_', 'g'), 255),
          p_mime, p_size, null)
  returning * into d;
  return d;
end $$;
revoke all on function public.client_begin_document_upload(text, text, text, bigint) from public, anon;
grant execute on function public.client_begin_document_upload(text, text, text, bigint) to authenticated;

-- One of MY pending uploads (the API needs its storage location to check the stored file).
create or replace function public.client_pending_document(p_document uuid)
returns public.customer_documents language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  d public.customer_documents;
begin
  select * into d from public.customer_documents where id = p_document and customer_id = v_customer and status = 'PENDING' and uploaded_by is null;
  if d.id is null then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  return d;
end $$;
revoke all on function public.client_pending_document(uuid) from public, anon;
grant execute on function public.client_pending_document(uuid) to authenticated;

-- The stored file turned out fine: it becomes the current file of the item (an older one is kept as history),
-- the checklist entry goes to SAVED (the existing trigger) and the support team is told to verify it.
create or replace function public.client_complete_document_upload(p_document uuid, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  d public.customer_documents;
  t public.document_types;
  i public.onboarding_items;
  c public.customers;
  e public.customer_onboarding_entries;
  v_replaced uuid;
begin
  select * into d from public.customer_documents
   where id = p_document and customer_id = v_customer and uploaded_by is null for update;
  if d.id is null then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  select * into i from private.client_items(v_customer) x where x.code = d.document_type and x.kind = 'FILE';
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This document is not part of your onboarding.' using errcode = 'P0001';
  end if;
  select * into e from public.customer_onboarding_entries where customer_id = v_customer and item_code = d.document_type;
  if e.status = 'VERIFIED' then
    raise exception 'CONFLICT: This document was already verified by our team.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = d.document_type;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File size exceeds the limit.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer for update;

  update public.customer_documents set status = 'SUPERSEDED'
   where customer_id = v_customer and document_type = d.document_type and status = 'UPLOADED' and invoice_id is not distinct from d.invoice_id and id <> d.id
  returning id into v_replaced;
  update public.customer_documents
     set status = 'UPLOADED', size_bytes = p_size, uploaded_at = now(),
         version = coalesce((select max(x.version) from public.customer_documents x
                              where x.customer_id = v_customer and x.document_type = d.document_type), 0) + 1
   where id = p_document returning * into d;

  update public.customer_onboarding_entries set saved_by_client = true where customer_id = v_customer and item_code = d.document_type;
  perform private.write_audit(case when v_replaced is null then 'CLIENT_DOCUMENT_UPLOADED' else 'CLIENT_DOCUMENT_REPLACED' end,
    'customer_document', d.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', v_customer, 'document_type', d.document_type, 'version', d.version, 'replaced_document_id', v_replaced, 'size_bytes', p_size));
  perform private.log_customer_activity(v_customer, 'CLIENT_DOCUMENT_UPLOADED',
    format('The client %s %s (v%s)', case when v_replaced is null then 'uploaded' else 'replaced' end, t.label, d.version));
  perform private.notify_customer_team(v_customer, 'CLIENT_DOCUMENT_UPLOADED', format('Document to verify: %s', coalesce(c.company, c.name)),
    format('%s uploaded "%s". Open Client documents to verify it.', coalesce(c.company, c.name), t.label), 'customer', v_customer);
  return d;
end $$;
revoke all on function public.client_complete_document_upload(uuid, bigint) from public, anon;
grant execute on function public.client_complete_document_upload(uuid, bigint) to authenticated;

create or replace function public.client_abort_document_upload(p_document uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  update public.customer_documents set status = 'FAILED'
   where id = p_document and customer_id = v_customer and status = 'PENDING' and uploaded_by is null;
end $$;
revoke all on function public.client_abort_document_upload(uuid) from public, anon;
grant execute on function public.client_abort_document_upload(uuid) to authenticated;

-- A typed detail (for example a website link) instead of a file.
create or replace function public.client_save_detail(p_item text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  i public.onboarding_items;
  c public.customers;
  e public.customer_onboarding_entries;
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  select * into i from private.client_items(v_customer) x where x.code = p_item and x.kind in ('DETAILS', 'CHOICE');
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This item is not part of your onboarding.' using errcode = 'P0001';
  end if;
  if v_value is null then
    raise exception 'VALIDATION_ERROR: Enter a value.' using errcode = 'P0001';
  end if;
  if length(v_value) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep it under 4000 characters.' using errcode = 'P0001';
  end if;
  if i.kind = 'CHOICE' and not (v_value = any (i.options)) then
    raise exception 'VALIDATION_ERROR: Choose one of the options.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer for update;
  select * into e from public.customer_onboarding_entries where customer_id = v_customer and item_code = p_item for update;
  if e.status = 'VERIFIED' then
    raise exception 'CONFLICT: This detail was already verified by our team. Raise a ticket if it has to change.' using errcode = 'P0001';
  end if;
  insert into public.customer_onboarding_entries as x (customer_id, item_code, value, status, saved_by, saved_by_client, saved_at)
  values (v_customer, p_item, v_value, 'SAVED', null, true, now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, document_id = null, status = 'SAVED', saved_by = null, saved_by_client = true, saved_at = now(),
        reviewed_by = null, reviewed_at = null, review_note = case when x.status = 'REJECTED' then x.review_note end;
  perform private.refresh_onboarding_progress(v_customer);
  perform private.log_customer_activity(v_customer, 'CLIENT_DETAIL_SAVED', format('The client saved "%s"', i.label));
  perform private.notify_customer_team(v_customer, 'CLIENT_DOCUMENT_UPLOADED', format('Detail to verify: %s', coalesce(c.company, c.name)),
    format('%s filled in "%s". Open Client documents to verify it.', coalesce(c.company, c.name), i.label), 'customer', v_customer);
end $$;
revoke all on function public.client_save_detail(text, text) from public, anon;
grant execute on function public.client_save_detail(text, text) to authenticated;

-- Where the file of one of MY current documents lives (never a path from the request).
create or replace function public.client_document_download(p_document uuid)
returns table (storage_provider text, storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return query
    select d.storage_provider, d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type
      from public.customer_documents d
     where d.id = p_document and d.customer_id = v_customer and d.status = 'UPLOADED' and d.document_type <> 'INVOICE'
       and exists (select 1 from private.client_items(v_customer) i where i.code = d.document_type);
end $$;
revoke all on function public.client_document_download(uuid) from public, anon;
grant execute on function public.client_document_download(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Staff: verify what clients uploaded
-- ---------------------------------------------------------------------------
-- p_status: PENDING (waiting for review), REVIEWED (verified or sent back in the last 30 days).
create or replace function public.client_document_queue(p_status text default 'PENDING')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_status not in ('PENDING', 'REVIEWED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'customerId', c.id, 'customer', coalesce(nullif(c.company, ''), c.name), 'contact', c.name,
      'itemCode', e.item_code, 'label', i.label, 'kind', i.kind, 'status', e.status, 'value', e.value,
      'documentId', e.document_id, 'fileName', d.original_file_name,
      'savedAt', e.saved_at, 'reviewedAt', e.reviewed_at, 'reviewNote', e.review_note,
      'reviewedBy', (select p.full_name from public.profiles p where p.id = e.reviewed_by),
      'services', coalesce((select jsonb_agg(s.name order by s.sort_order)
                              from public.onboarding_item_services m
                              join public.crm_services s on s.code = m.service_code
                              join public.customer_services cs on cs.service_code = s.code and cs.customer_id = c.id
                             where m.item_code = e.item_code), '[]'::jsonb))
      order by e.saved_at desc)
    from public.customer_onboarding_entries e
    join public.customers c on c.id = e.customer_id
    join public.onboarding_items i on i.code = e.item_code
    left join public.customer_documents d on d.id = e.document_id
   where e.saved_by_client and private.can_serve_client(c.id)
     and ((p_status = 'PENDING' and e.status = 'SAVED')
       or (p_status = 'REVIEWED' and e.status in ('VERIFIED', 'REJECTED') and e.reviewed_at > now() - interval '30 days'))), '[]'::jsonb);
end $$;
revoke all on function public.client_document_queue(text) from public, anon;
grant execute on function public.client_document_queue(text) to authenticated;

create or replace function public.review_client_document(p_customer uuid, p_item text, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  i public.onboarding_items;
  e public.customer_onboarding_entries;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.can_serve_client(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_decision not in ('VERIFIED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose verify or reject.' using errcode = 'P0001';
  end if;
  if p_decision = 'REJECTED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Tell the client what needs fixing.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into i from public.onboarding_items where code = p_item;
  select * into e from public.customer_onboarding_entries where customer_id = p_customer and item_code = p_item for update;
  if e.item_code is null or not e.saved_by_client then
    raise exception 'CONFLICT: The client has not provided this item.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding_entries
     set status = p_decision, reviewed_by = (select private.my_id()), reviewed_at = now(), review_note = left(v_note, 1000)
   where customer_id = p_customer and item_code = p_item;
  perform private.refresh_onboarding_progress(p_customer);
  perform private.log_customer_activity(p_customer, case when p_decision = 'VERIFIED' then 'CLIENT_DOCUMENT_VERIFIED' else 'CLIENT_DOCUMENT_REJECTED' end,
    case when p_decision = 'VERIFIED' then format('%s verified', i.label) else format('%s needs fixing: %s', i.label, v_note) end);
  perform private.write_audit(case when p_decision = 'VERIFIED' then 'CLIENT_DOCUMENT_VERIFIED' else 'CLIENT_DOCUMENT_REJECTED' end,
    'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('item', p_item, 'note', v_note));
  perform private.client_notify(p_customer, case when p_decision = 'VERIFIED' then 'DOCUMENT_VERIFIED' else 'DOCUMENT_REJECTED' end,
    case when p_decision = 'VERIFIED' then format('%s was verified', i.label) else format('%s needs your attention', i.label) end,
    case when p_decision = 'VERIFIED' then 'Our team checked it. Nothing more is needed for this item.'
         else format('Please upload it again. %s', v_note) end,
    'document', null, format('DOC|%s|%s|%s|%s', p_customer, p_item, p_decision, (extract(epoch from clock_timestamp()) * 1000)::bigint));
end $$;
revoke all on function public.review_client_document(uuid, text, text, text) from public, anon;
grant execute on function public.review_client_document(uuid, text, text, text) to authenticated;

-- Staff: where the file of a client's upload lives (only for those who serve that client).
create or replace function public.client_upload_download(p_document uuid)
returns table (storage_provider text, storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    select d.storage_provider, d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type
      from public.customer_documents d
      join public.customer_onboarding_entries e on e.customer_id = d.customer_id and e.item_code = d.document_type and e.document_id = d.id
     where d.id = p_document and d.status = 'UPLOADED' and e.saved_by_client and private.can_serve_client(d.customer_id);
end $$;
revoke all on function public.client_upload_download(uuid) from public, anon;
grant execute on function public.client_upload_download(uuid) to authenticated;

-- Staff: the customers the caller serves (to pick one when logging activity). Only customers that are in
-- onboarding or already customers; the search matches name, business, code, phone and e-mail.
create or replace function public.client_activity_customers(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.customer_code, 'name', x.name, 'company', x.company,
             'hasClientLogin', exists (select 1 from public.customer_client_accounts a where a.customer_id = x.id)) order by x.created_at desc)
    from (
      select c.id, c.customer_code, c.name, c.company, c.created_at
        from public.customers c
       where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and private.can_serve_client(c.id)
         and (v_search is null or c.name ilike '%' || v_search || '%' or coalesce(c.company, '') ilike '%' || v_search || '%'
              or coalesce(c.customer_code, '') ilike '%' || v_search || '%' or coalesce(c.phone, '') ilike '%' || v_search || '%'
              or coalesce(c.email, '') ilike '%' || v_search || '%')
       order by c.created_at desc limit 30) x), '[]'::jsonb);
end $$;
revoke all on function public.client_activity_customers(text) from public, anon;
grant execute on function public.client_activity_customers(text) to authenticated;
