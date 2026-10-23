-- =============================================================================
-- The 8 migrations after 20261110000200_security_events.sql, in order.
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Every part is idempotent (safe to run again); nothing is deleted.
--   1. 20261111000100_ticket_attachments.sql          files on support tickets (clients and staff), 5 files per message, 5 MB each
--   2. 20261112000100_subscription_reminders.sql      subscription expiry reminders: consent, tracking, the 7/3/1-day scheduler (no calls are placed)
--   3. 20261112000200_paid_only_invoices.sql          paid invoices only, GST decided by Accounts
--   4. 20261112000300_company_workflow.sql            Super Admin Company Workflow
--   5. 20261113000100_delete_customer.sql             delete customers (Super Admin, Department Head)
--   6. 20261113000200_manual_invoice_pricing.sql      manual invoice pricing
--   7. 20261114000100_revenue_attribution.sql         department-wise income attribution
--   8. 20261114000200_payment_gst.sql                 GST when Accounts records a payment
-- Keep this order: 8 replaces functions that 3 defines, so running 3 after 8 would undo part of 8.
-- Needs every migration up to 20261110000200_security_events.sql to be applied already.
-- NOT included: the HR / Performance migrations (20261115000100, 20261116000100 to 20261116000300): they have their own file,
-- run_these_3_migrations_performance_hr.sql.
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261111000100_ticket_attachments.sql
-- Ticket attachments: files on a support ticket, from the client and from Support.
--
-- A file is uploaded (a short-lived, single-use signed upload issued by the API after the database allowed it), confirmed (the API looks at the
-- stored object: it exists, its size, its first bytes match its type), then attached to the message or the new ticket it was written for.
-- LIMITS, enforced here in the database as well as in the screens and the API: at most 5 files per message (25 per ticket), each at most 5 MB, and only
-- images (PNG, JPEG, WebP), PDF, text, CSV, Word (.docx) and Excel (.xlsx).
-- VISIBILITY: a client sees only the files of their own ticket's client-visible messages; Support sees the files of the tickets it may read (a file
-- on an internal note is never shown to the client). A file that is not attached yet can be opened only by the person who uploaded it.
-- Nothing is reachable directly: the table has no grant, only these functions read or write it.
--
-- Replaces send_ticket_message, create_support_ticket, client_create_ticket and client_send_ticket_message with the same behaviour plus an optional
-- p_attachments list (older callers do not send it). Run after 20261110000200_security_events.sql. Safe to run again.

create table if not exists public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  ticket_id uuid references public.support_tickets (id) on delete cascade,
  update_id uuid references public.support_ticket_updates (id) on delete cascade,
  uploader_id uuid references public.profiles (id) on delete set null,
  uploader_client boolean not null default false,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  status text not null default 'PENDING' check (status in ('PENDING', 'READY', 'FAILED')),
  storage_bucket text not null default 'ticket-attachments',
  storage_path text not null,
  storage_provider text check (storage_provider in ('SUPABASE', 'R2')),
  storage_ref text,
  storage_etag text,
  created_at timestamptz not null default now(),
  -- a file belongs to a message or to nothing yet; if it belongs to a message it belongs to that message's ticket
  check (update_id is null or ticket_id is not null)
);
create index if not exists support_ticket_attachments_ticket_idx on public.support_ticket_attachments (ticket_id, created_at) where ticket_id is not null;
create index if not exists support_ticket_attachments_update_idx on public.support_ticket_attachments (update_id) where update_id is not null;
create index if not exists support_ticket_attachments_pending_idx on public.support_ticket_attachments (created_at) where status = 'PENDING';
alter table public.support_ticket_attachments enable row level security;
revoke all on public.support_ticket_attachments from public, anon, authenticated;

-- Private bucket (no browser access: the API signs short-lived links after the database allowed the download).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ticket-attachments', 'ticket-attachments', false, 5242880,
            array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Upload: book it (the database checks the person, the type and the size)
-- ---------------------------------------------------------------------------
create or replace function public.ticket_begin_upload(p_ticket uuid, p_customer uuid, p_file_name text, p_mime text, p_size bigint)
returns public.support_ticket_attachments language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := private.my_client_customer();
  me uuid := private.my_id();
  v_customer uuid;
  t public.support_tickets;
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  r public.support_ticket_attachments;
begin
  if v_client is not null then
    v_customer := v_client;
    if p_ticket is not null then
      select * into t from public.support_tickets where id = p_ticket and customer_id = v_client;
      if t.id is null then
        raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
      end if;
      if t.status = 'CLOSED' then
        raise exception 'CONFLICT: This ticket is closed. Please raise a new ticket.' using errcode = 'P0001';
      end if;
    end if;
  else
    if not exists (select 1 from public.profiles p where p.id = me and p.status = 'ACTIVE') then
      raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
    end if;
    if p_ticket is not null then
      if not private.can_view_ticket(p_ticket) then
        raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
      end if;
      select * into t from public.support_tickets where id = p_ticket;
      v_customer := t.customer_id;
    else
      if p_customer is null or not private.can_view_customer(p_customer) then
        raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
      end if;
      v_customer := p_customer;
    end if;
  end if;
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'VALIDATION_ERROR: This file type cannot be attached. Use an image, PDF, text, CSV, Word or Excel file.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.support_ticket_attachments set status = 'FAILED'
   where status = 'PENDING' and created_at < now() - interval '1 day' and customer_id = v_customer
     and ((v_client is not null and uploader_client) or (v_client is null and uploader_id = me));
  if (select count(*) from public.support_ticket_attachments a
       where a.status = 'PENDING' and a.created_at > now() - interval '1 hour'
         and ((v_client is not null and a.uploader_client and a.customer_id = v_client) or (v_client is null and a.uploader_id = me))) >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  insert into public.support_ticket_attachments (id, customer_id, ticket_id, uploader_id, uploader_client, file_name, mime_type, size_bytes, storage_path)
  values (v_id, v_customer, p_ticket, case when v_client is null then me end, v_client is not null, v_name, p_mime, p_size,
          format('%s/%s/%s', v_customer, v_id, private.chat_clean_name(v_name)))
  returning * into r;
  return r;
end $$;

-- the caller's own PENDING upload
create or replace function private.ticket_own_pending(p_attachment uuid)
returns public.support_ticket_attachments language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := private.my_client_customer();
  r public.support_ticket_attachments;
begin
  select * into r from public.support_ticket_attachments a
   where a.id = p_attachment and a.status = 'PENDING'
     and ((v_client is not null and a.uploader_client and a.customer_id = v_client) or (v_client is null and a.uploader_id = private.my_id()));
  if r.id is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  return r;
end $$;
revoke all on function private.ticket_own_pending(uuid) from public, anon, authenticated;

create or replace function public.ticket_pending_upload(p_attachment uuid)
returns public.support_ticket_attachments language sql stable security definer set search_path = '' as $$
  select * from private.ticket_own_pending(p_attachment)
$$;

create or replace function public.ticket_complete_upload(p_attachment uuid, p_size bigint, p_etag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_ticket_attachments;
begin
  r := private.ticket_own_pending(p_attachment);
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.support_ticket_attachments set status = 'READY', size_bytes = p_size, storage_etag = coalesce(p_etag, storage_etag) where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'name', r.file_name, 'mime', r.mime_type, 'size', r.size_bytes);
end $$;

create or replace function public.ticket_abort_upload(p_attachment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := private.my_client_customer();
begin
  update public.support_ticket_attachments a set status = 'FAILED'
   where a.id = p_attachment and a.status = 'PENDING'
     and ((v_client is not null and a.uploader_client and a.customer_id = v_client) or (v_client is null and a.uploader_id = private.my_id()));
end $$;

-- ---------------------------------------------------------------------------
-- Attach the uploaded files to the message (or the new ticket) they were written for
-- ---------------------------------------------------------------------------
create or replace function private.ticket_attach(p_ticket uuid, p_update uuid, p_attachments uuid[], p_customer uuid, p_by_client boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_n integer;
  v_found integer;
  v_bytes bigint;
  v_linked integer;
  t public.support_tickets;
begin
  if p_attachments is null or cardinality(p_attachments) = 0 then
    return;
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_attachments) x;
  v_n := cardinality(v_ids);
  if v_n > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files at a time.' using errcode = 'P0001';
  end if;
  select count(*), coalesce(sum(a.size_bytes), 0) into v_found, v_bytes
    from public.support_ticket_attachments a
   where a.id = any (v_ids) and a.status = 'READY' and a.update_id is null and a.customer_id = p_customer
     and (a.ticket_id is null or a.ticket_id = p_ticket)
     and ((p_by_client and a.uploader_client) or (not p_by_client and a.uploader_id = private.my_id()));
  if v_found <> v_n then
    raise exception 'VALIDATION_ERROR: One of the files is not ready or was already sent. Upload it again.' using errcode = 'P0001';
  end if;
  select count(*) into v_linked from public.support_ticket_attachments a where a.ticket_id = p_ticket and a.update_id is not null;
  if v_linked + v_n > 25 then
    raise exception 'VALIDATION_ERROR: This ticket already holds the most files it can (25). Raise a new ticket for more.' using errcode = 'P0001';
  end if;
  update public.support_ticket_attachments set ticket_id = p_ticket, update_id = p_update where id = any (v_ids);
  select * into t from public.support_tickets where id = p_ticket;
  perform private.write_audit('TICKET_ATTACHMENT_ADDED', 'support_ticket', p_ticket, t.department_id, t.team_id,
    jsonb_build_object('count', v_n, 'bytes', v_bytes, 'by_client', p_by_client));
end $$;
revoke all on function private.ticket_attach(uuid, uuid, uuid[], uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading: the files of a ticket, and one file's download (checked again every time)
-- ---------------------------------------------------------------------------
create or replace function public.ticket_attachments(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := private.my_client_customer();
begin
  if v_client is not null then
    if not exists (select 1 from public.support_tickets t where t.id = p_ticket and t.customer_id = v_client) then
      raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
    end if;
  elsif not private.can_view_ticket(p_ticket) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'updateId', a.update_id, 'name', a.file_name, 'mime', a.mime_type, 'size', a.size_bytes,
                                       'fromClient', a.uploader_client) order by a.created_at, a.id)
      from public.support_ticket_attachments a
      join public.support_ticket_updates u on u.id = a.update_id
     where a.ticket_id = p_ticket and a.status = 'READY'
       -- the client never sees a file on an internal note
       and (v_client is null or u.client_visible or u.client_author)), '[]'::jsonb);
end $$;

create or replace function public.ticket_attachment_download(p_attachment uuid)
returns public.support_ticket_attachments language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := private.my_client_customer();
  r public.support_ticket_attachments;
  u public.support_ticket_updates;
  t public.support_tickets;
begin
  select * into r from public.support_ticket_attachments a where a.id = p_attachment and a.status = 'READY';
  if r.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  if r.update_id is null then
    -- not attached yet: only the person who uploaded it
    if not ((v_client is not null and r.uploader_client and r.customer_id = v_client) or (v_client is null and r.uploader_id = private.my_id())) then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
    return r;
  end if;
  select * into u from public.support_ticket_updates where id = r.update_id;
  if v_client is not null then
    if r.customer_id <> v_client or not (u.client_visible or u.client_author) then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
  elsif not private.can_view_ticket(r.ticket_id) then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  select * into t from public.support_tickets where id = r.ticket_id;
  perform private.write_audit('TICKET_ATTACHMENT_DOWNLOADED', 'support_ticket', r.ticket_id, t.department_id, t.team_id,
    jsonb_build_object('attachment_id', r.id, 'by_client', v_client is not null));
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- The four functions that write tickets and ticket messages, now with an optional list of uploaded files
-- ---------------------------------------------------------------------------
drop function if exists public.client_create_ticket(text, text, text, text);
drop function if exists public.client_send_ticket_message(uuid, text, uuid);
drop function if exists public.send_ticket_message(uuid, text, boolean, uuid);
drop function if exists public.create_support_ticket(uuid, text, text, text, text, uuid);

create or replace function public.client_create_ticket(p_subject text, p_description text, p_category text DEFAULT 'GENERAL'::text, p_service text DEFAULT NULL::text, p_attachments uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_customer uuid := private.require_client();
  c public.customers;
  t public.support_tickets;
  v_team uuid;
  v_assignee uuid;
  v_lead uuid;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_upd uuid;
begin
  if length(v_subject) < 3 or length(v_subject) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a subject (3 to 200 characters).' using errcode = 'P0001';
  end if;
  if v_desc is null or length(v_desc) < 5 or length(v_desc) > 4000 then
    raise exception 'VALIDATION_ERROR: Describe the problem (5 to 4000 characters).' using errcode = 'P0001';
  end if;
  if coalesce(p_category, 'GENERAL') not in ('GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown category.' using errcode = 'P0001';
  end if;
  if p_service is not null and not exists (select 1 from public.customer_services cs where cs.customer_id = v_customer and cs.service_code = p_service) then
    raise exception 'VALIDATION_ERROR: Choose one of your own services.' using errcode = 'P0001';
  end if;
  -- one request at a time per customer, so two identical submissions cannot both pass the check below
  perform pg_advisory_xact_lock(hashtextextended('client_ticket:' || v_customer::text, 0));
  select * into t from public.support_tickets x
   where x.customer_id = v_customer and x.created_by is null and x.subject = v_subject and x.description = v_desc
     and x.status not in ('RESOLVED', 'CLOSED') and x.created_at > now() - interval '10 minutes'
   order by x.created_at desc limit 1;
  if t.id is not null then
    return private.client_ticket_json(t);
  end if;
  if (select count(*) from public.support_tickets x where x.customer_id = v_customer and x.created_at > now() - interval '1 day') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many tickets today. Please reply to an open ticket or try again tomorrow.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  select o.o_team, o.o_assignee, o.o_lead into v_team, v_assignee, v_lead from private.client_ticket_owner(v_customer) o;
  insert into public.support_tickets (customer_id, department_id, team_id, subject, description, category, priority, service_code, created_by, assignee_id)
  values (v_customer, c.department_id, v_team, v_subject, v_desc, coalesce(p_category, 'GENERAL'), 'MEDIUM', p_service, null, v_assignee)
  returning * into t;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, to_status, note, client_author)
  values (t.id, null, 'CREATED', 'OPEN', v_desc, true)
  returning id into v_upd;
  perform private.ticket_attach(t.id, v_upd, p_attachments, v_customer, true);
  if v_assignee is not null then
    insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author, assignee_id)
    values (t.id, null, 'ASSIGNED', 'Assigned to ' || (select full_name from public.profiles where id = v_assignee) || ' (the client''s Relationship Manager)', false, v_assignee);
  elsif t.escalated_to is not null then
    insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author, assignee_id)
    values (t.id, null, 'ASSIGNED', format('No Relationship Manager yet: with %s %s',
              case t.escalation_level when 'TL' then 'Team Lead' else 'Department Head' end,
              (select full_name from public.profiles where id = t.escalated_to)), false, t.escalated_to);
  end if;
  perform private.client_notify(v_customer, 'TICKET_CREATED', format('Ticket %s created', t.ticket_no), v_subject, 'ticket', t.id, format('TKT|created|%s', t.id));
  perform private.log_customer_activity(v_customer, 'CLIENT_TICKET', format('Client raised ticket %s: %s', t.ticket_no, v_subject));
  perform private.write_audit('CLIENT_TICKET_CREATED', 'support_ticket', t.id, c.department_id, v_team,
    jsonb_build_object('ticket_no', t.ticket_no, 'customer_id', v_customer, 'assignee', v_assignee, 'level', t.escalation_level));
  -- the RM, their lead (or the team's leads while nobody is assigned), whoever it starts with, and the Department Head
  perform private.notify(r.id, 'TICKET_FROM_CLIENT', format('New client ticket %s: %s', t.ticket_no, v_subject), left(v_desc, 300), 'support_ticket', t.id)
    from (select v_assignee as id where v_assignee is not null
          union
          select t.escalated_to where t.escalated_to is not null
          union
          select p.id from public.profiles p
           where p.status = 'ACTIVE'
             and ((p.role = 'TEAM_HEAD' and (p.id = v_lead or (v_lead is null and p.team_id = v_team)))
                  or (p.role = 'DEPARTMENT_HEAD' and p.department_id = c.department_id))) r;
  return private.client_ticket_json(t);
end $function$;
revoke all on function public.client_create_ticket(text, text, text, text, uuid[]) from public, anon;
grant execute on function public.client_create_ticket(text, text, text, text, uuid[]) to authenticated;

create or replace function public.client_send_ticket_message(p_ticket uuid, p_message text, p_client_msg_id uuid DEFAULT NULL::uuid, p_attachments uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_customer uuid := private.require_client();
  t public.support_tickets;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_upd uuid;
begin
  select * into t from public.support_tickets where id = p_ticket and customer_id = v_customer for update;
  if t.id is null then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if v_msg is null or length(v_msg) > 4000 then
    raise exception 'VALIDATION_ERROR: Write your message (up to 4000 characters).' using errcode = 'P0001';
  end if;
  if (p_client_msg_id is not null and exists (select 1 from public.support_ticket_updates u where u.ticket_id = t.id and u.client_msg_id = p_client_msg_id))
     or (p_client_msg_id is null and exists (select 1 from public.support_ticket_updates u
              where u.ticket_id = t.id and u.client_author and u.kind = 'CLIENT_REPLY'
                and u.note = v_msg and u.created_at > now() - interval '2 minutes')) then
    return public.client_ticket(t.id);  -- already sent (double click, retry)
  end if;
  if t.status = 'CLOSED' then
    raise exception 'CONFLICT: This ticket is closed. Please raise a new ticket.' using errcode = 'P0001';
  end if;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author, client_msg_id)
  values (t.id, null, 'CLIENT_REPLY', v_msg, true, p_client_msg_id)
  returning id into v_upd;
  perform private.ticket_attach(t.id, v_upd, p_attachments, v_customer, true);
  -- writing in the ticket means the client has read it
  if t.status in ('RESOLVED', 'WAITING_CUSTOMER') then
    update public.support_tickets set status = 'OPEN', resolved_at = null, client_read_at = now() where id = t.id;
    insert into public.support_ticket_updates (ticket_id, author_id, kind, from_status, to_status, client_author)
    values (t.id, null, 'STATUS_CHANGED', t.status, 'OPEN', true);
  else
    update public.support_tickets set updated_at = now(), client_read_at = now() where id = t.id;
  end if;
  perform private.notify(r.id, 'TICKET_CLIENT_REPLY', format('Client replied on %s', t.ticket_no), left(v_msg, 300), 'support_ticket', t.id,
                         '{}'::jsonb, case when r.id = coalesce(t.escalated_to, t.assignee_id) then 'urgent' else 'normal' end)
    from (select p.id from public.profiles p
           where p.status = 'ACTIVE'
             and (p.id = t.assignee_id or p.id = t.escalated_to or (p.role = 'TEAM_HEAD' and p.team_id = t.team_id))) r;
  return public.client_ticket(t.id);
exception when unique_violation then
  return public.client_ticket(p_ticket);  -- the same message arrived twice at the same moment
end $function$;
revoke all on function public.client_send_ticket_message(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.client_send_ticket_message(uuid, text, uuid, uuid[]) to authenticated;

create or replace function public.send_ticket_message(p_ticket uuid, p_message text, p_internal boolean DEFAULT false, p_client_msg_id uuid DEFAULT NULL::uuid, p_attachments uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me public.profiles;
  t public.support_tickets;
  u public.support_ticket_updates;
  v_msg text := left(nullif(btrim(coalesce(p_message, '')), ''), 4000);
  v_internal boolean := coalesce(p_internal, false);
  v_recipient uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if v_msg is null then
    raise exception 'VALIDATION_ERROR: Write the message first.' using errcode = 'P0001';
  end if;
  if p_client_msg_id is not null then
    select * into u from public.support_ticket_updates x where x.ticket_id = t.id and x.client_msg_id = p_client_msg_id;
    if u.id is not null then
      return private.staff_message_json(u);  -- already stored (retry / double click)
    end if;
  else
    select * into u from public.support_ticket_updates x
     where x.ticket_id = t.id and x.author_id = me.id and x.kind = 'NOTE' and x.client_visible = not v_internal
       and x.note = v_msg and x.created_at > now() - interval '2 minutes'
     order by x.created_at desc limit 1;
    if u.id is not null then
      return private.staff_message_json(u);
    end if;
  end if;
  if not v_internal and t.status = 'CLOSED' then
    raise exception 'CONFLICT: This ticket is closed.' using errcode = 'P0001';
  end if;

  insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_visible, client_msg_id)
  values (t.id, me.id, 'NOTE', v_msg, not v_internal, p_client_msg_id)
  returning * into u;
  perform private.ticket_attach(t.id, u.id, p_attachments, t.customer_id, false);
  update public.support_tickets set updated_at = now() where id = t.id;

  if v_internal then
    for v_recipient in
      select distinct r from unnest(array[t.assignee_id, t.escalated_to]) r where r is not null and r <> me.id
    loop
      perform private.notify(v_recipient, 'TICKET_NOTE', format('%s added a note on %s', me.full_name, t.ticket_no),
        left(v_msg, 300), 'support_ticket', t.id);
    end loop;
  else
    perform private.write_audit('TICKET_REPLIED_TO_CLIENT', 'support_ticket', t.id, t.department_id, t.team_id, jsonb_build_object('ticket_no', t.ticket_no));
    -- The RM stays informed when a Team Lead / Department Head answers, and the current owner when someone else does.
    for v_recipient in
      select distinct r from unnest(array[t.assignee_id, t.escalated_to]) r where r is not null and r <> me.id
    loop
      perform private.notify(v_recipient, 'TICKET_STAFF_REPLY', format('%s replied to the customer on %s', me.full_name, t.ticket_no),
        left(v_msg, 300), 'support_ticket', t.id);
    end loop;
  end if;
  return private.staff_message_json(u);
exception when unique_violation then
  -- two identical requests at the same moment: the other one stored it
  select * into u from public.support_ticket_updates x where x.ticket_id = p_ticket and x.client_msg_id = p_client_msg_id;
  if u.id is null then
    raise;
  end if;
  return private.staff_message_json(u);
end $function$;
revoke all on function public.send_ticket_message(uuid, text, boolean, uuid, uuid[]) from public, anon;
grant execute on function public.send_ticket_message(uuid, text, boolean, uuid, uuid[]) to authenticated;

create or replace function public.create_support_ticket(p_customer uuid, p_subject text, p_description text, p_category text, p_priority text, p_assignee uuid DEFAULT NULL::uuid, p_attachments uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me public.profiles;
  c public.customers;
  a public.profiles;
  v_assignee uuid := p_assignee;
  v_team uuid;
  v_dept uuid;
  v_id uuid;
  v_no text;
  v_lead uuid;
  v_upd uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.can_view_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  if length(trim(coalesce(p_subject, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: Enter a ticket subject (at least 3 characters).' using errcode = 'P0001';
  end if;
  if coalesce(p_category, 'GENERAL') not in ('GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown category.' using errcode = 'P0001';
  end if;
  if coalesce(p_priority, 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;

  -- Members and leads who raise a ticket own it unless a lead hands it to someone.
  if v_assignee is null and me.role in ('TEAM_MEMBER', 'TEAM_HEAD') then
    v_assignee := me.id;
  end if;
  if v_assignee is not null and not private.can_assign_ticket_to(v_assignee) then
    raise exception 'FORBIDDEN: You cannot assign tickets to this user.' using errcode = '42501';
  end if;
  if v_assignee is not null then
    select * into a from public.profiles where id = v_assignee;
    v_team := a.team_id;
    v_dept := a.department_id;
  else
    v_team := me.team_id;
    v_dept := coalesce(me.department_id, c.department_id);
  end if;

  insert into public.support_tickets (customer_id, department_id, team_id, subject, description, category, priority,
                                      assignee_id, created_by)
  values (c.id, v_dept, v_team, trim(p_subject), nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_category, 'GENERAL'), coalesce(p_priority, 'MEDIUM'), v_assignee, me.id)
  returning id, ticket_no into v_id, v_no;

  insert into public.support_ticket_updates (ticket_id, author_id, kind, to_status, assignee_id, note)
  values (v_id, me.id, 'CREATED', 'OPEN', v_assignee, nullif(trim(coalesce(p_description, '')), ''))
  returning id into v_upd;
  perform private.ticket_attach(v_id, v_upd, p_attachments, c.id, false);
  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'TICKET_OPENED', format('%s · %s', v_no, trim(p_subject)));
  perform private.write_audit('TICKET_CREATED', 'support_ticket', v_id, v_dept, v_team,
    jsonb_build_object('ticket_no', v_no, 'customer_id', c.id, 'assignee', v_assignee));

  if v_assignee is not null and v_assignee <> me.id then
    perform private.notify(v_assignee, 'TICKET_ASSIGNED', format('Ticket %s: %s', v_no, trim(p_subject)),
      format('%s · assigned by %s', c.name, me.full_name), 'support_ticket', v_id);
  end if;
  for v_lead in select id from public.profiles
                 where role = 'TEAM_HEAD' and status = 'ACTIVE' and team_id = v_team and id <> me.id loop
    perform private.notify(v_lead, 'TICKET_CREATED', format('New ticket %s: %s', v_no, trim(p_subject)),
      format('%s · %s priority', c.name, lower(coalesce(p_priority, 'MEDIUM'))), 'support_ticket', v_id);
  end loop;
  return v_id;
end $function$;
revoke all on function public.create_support_ticket(uuid, text, text, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.create_support_ticket(uuid, text, text, text, text, uuid, uuid[]) to authenticated;

revoke all on function public.ticket_begin_upload(uuid, uuid, text, text, bigint) from public, anon;
grant execute on function public.ticket_begin_upload(uuid, uuid, text, text, bigint) to authenticated;
revoke all on function public.ticket_pending_upload(uuid) from public, anon;
grant execute on function public.ticket_pending_upload(uuid) to authenticated;
revoke all on function public.ticket_complete_upload(uuid, bigint, text) from public, anon;
grant execute on function public.ticket_complete_upload(uuid, bigint, text) to authenticated;
revoke all on function public.ticket_abort_upload(uuid) from public, anon;
grant execute on function public.ticket_abort_upload(uuid) to authenticated;
revoke all on function public.ticket_attachments(uuid) from public, anon;
grant execute on function public.ticket_attachments(uuid) to authenticated;
revoke all on function public.ticket_attachment_download(uuid) from public, anon;
grant execute on function public.ticket_attachment_download(uuid) to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261112000100_subscription_reminders.sql
-- =============================================================================
-- Subscription expiry reminders (AI calls 7, 3 and 1 day before a service expires).
--
-- THIS MIGRATION DECIDES AND TRACKS REMINDERS; IT PLACES NO CALL. The sender (BolifyAI) is a separate step: until it exists the
-- API only prepares reminders ("dry run") and nothing leaves the server.
--
-- Source of truth for "when does this service expire": customer_services.renews_on (the "Renewal / Expiry Date" of the Excel
-- import), together with customer_services.service_status. No new subscription table. Invoice, payment and activation dates are
-- different things and are never used.
--
--  * reminder_call_settings        one row: the call window (Indian time) and whether customers with NO consent record may be called.
--  * customer_reminder_consent     the customer's call consent (ALLOWED with how it was obtained / DO_NOT_CALL). No row = unknown.
--  * subscription_reminders        one row per customer + service + expiry date + stage (7 / 3 / 1), UNIQUE event_key, so the same
--                                  reminder can never be queued twice for an expiry cycle. A changed expiry date is a new cycle.
--  * subscription_reminder_events  append-only log of every step (created, attempt, accepted, retry, failed, skipped, cancelled).
--  * sub_reminder_schedule()       the daily decider (service role, idempotent): creates the reminders due today.
--  * sub_reminder_claim()          takes due reminders for sending (SKIP LOCKED + lease). Re-checks everything at that moment: a
--                                  reminder is cancelled if the expiry date changed or the service was renewed, cancelled, paused or
--                                  expired, and skipped when the customer has no consent / asked not to be called, has no valid
--                                  mobile number, or the call window has passed. A late reminder is never sent after its window.
--  * sub_reminder_finish()         records the result: DRY_RUN / ACCEPTED / RETRY / FAILED / SKIPPED. ACCEPTED means the provider
--                                  took the request, NOT that a call was completed. At most 3 attempts (10 and 30 minutes apart).
--  * staff functions               set_customer_reminder_consent, set_customer_service_term, reminder settings, overview.
-- Dates use Indian time (Asia/Kolkata). Idempotent: safe to run again. No existing data is changed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_call_settings (
  id boolean primary key default true check (id),
  window_start time not null default '10:00',
  window_end time not null default '19:00',
  allow_unknown_consent boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (window_start >= time '08:00' and window_end <= time '21:00' and window_start < window_end)
);
insert into public.reminder_call_settings (id) values (true) on conflict (id) do nothing;
alter table public.reminder_call_settings enable row level security;
revoke all on public.reminder_call_settings from public, anon, authenticated;

create table if not exists public.customer_reminder_consent (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  status text not null check (status in ('ALLOWED', 'DO_NOT_CALL')),
  note text check (length(note) <= 300),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table public.customer_reminder_consent enable row level security;
revoke all on public.customer_reminder_consent from public, anon, authenticated;

create table if not exists public.subscription_reminders (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (length(event_key) <= 200),
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null,
  expiry_date date not null,                        -- the expiry date this reminder was made for (a later change cancels it)
  stage integer not null check (stage in (7, 3, 1)),
  status text not null default 'SCHEDULED' check (status in
    ('SCHEDULED', 'PROCESSING', 'ACCEPTED', 'COMPLETED', 'FAILED', 'RETRY', 'SKIPPED', 'CANCELLED', 'DRY_RUN')),
  send_after timestamptz not null,                  -- the call window opens
  send_until timestamptz not null,                  -- ... and closes: a reminder is not sent after this
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  external_call_id text check (length(external_call_id) <= 200),
  response_code integer,
  phone_masked text,
  reason text check (length(reason) <= 500),        -- why skipped / cancelled / failed (sanitized, no secrets, no full numbers)
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscription_reminders_due_idx on public.subscription_reminders (status, next_attempt_at)
  where status in ('SCHEDULED', 'RETRY', 'PROCESSING', 'DRY_RUN');
create index if not exists subscription_reminders_customer_idx on public.subscription_reminders (customer_id, expiry_date);
create index if not exists subscription_reminders_call_idx on public.subscription_reminders (external_call_id) where external_call_id is not null;
alter table public.subscription_reminders enable row level security;
revoke all on public.subscription_reminders from public, anon, authenticated;

create table if not exists public.subscription_reminder_events (
  id bigint generated always as identity primary key,
  reminder_id uuid not null references public.subscription_reminders (id) on delete cascade,
  at timestamptz not null default now(),
  event text not null check (event in ('CREATED', 'ATTEMPT', 'DRY_RUN', 'ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED', 'CANCELLED')),
  attempt integer,
  response_code integer,
  detail text check (length(detail) <= 500)
);
create index if not exists subscription_reminder_events_reminder_idx on public.subscription_reminder_events (reminder_id, at);
alter table public.subscription_reminder_events enable row level security;
revoke all on public.subscription_reminder_events from public, anon, authenticated;

create table if not exists public.subscription_reminder_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.subscription_reminder_state enable row level security;
revoke all on public.subscription_reminder_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The number to call, in +91 form, or null when neither the mobile nor the WhatsApp number is a valid Indian mobile.
create or replace function private.sub_reminder_phone(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select '+91' || coalesce(private.mobile10(c.phone), private.mobile10(c.whatsapp))
    from public.customers c
   where c.id = p_customer and coalesce(private.mobile10(c.phone), private.mobile10(c.whatsapp)) is not null
$$;
revoke all on function private.sub_reminder_phone(uuid) from public, anon, authenticated;

-- Why this reminder should no longer be sent (null = it is still valid): the expiry date changed or was removed, the service is
-- not live any more, or the customer is not a customer any more.
create or replace function private.sub_reminder_invalid(p_customer uuid, p_service text, p_expiry date)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when cs.customer_id is null then 'The service was removed from the customer.'
    when cs.renews_on is distinct from p_expiry then 'The expiry date changed (the service may have been renewed).'
    when coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) is distinct from 'LIVE'
      then 'The service is not live (' || coalesce(cs.service_status, 'not activated') || ').'
    when c.id is null or c.lifecycle_stage <> 'CUSTOMER' then 'The record is not an active customer.'
  end
  from (select 1) one
  left join public.customer_services cs on cs.customer_id = p_customer and cs.service_code = p_service
  left join public.customers c on c.id = p_customer
$$;
revoke all on function private.sub_reminder_invalid(uuid, text, date) from public, anon, authenticated;

create or replace function private.sub_reminder_log(p_reminder uuid, p_event text, p_attempt integer, p_code integer, p_detail text)
returns void language sql security definer set search_path = '' as $$
  insert into public.subscription_reminder_events (reminder_id, event, attempt, response_code, detail)
  values (p_reminder, p_event, p_attempt, p_code, left(p_detail, 500))
$$;
revoke all on function private.sub_reminder_log(uuid, text, integer, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The daily decider (service role). Idempotent: run it as often as you like.
-- ---------------------------------------------------------------------------
create or replace function public.sub_reminder_schedule(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.office_today());
  s public.reminder_call_settings;
  v_new integer := 0;
  v_cancelled integer := 0;
  v_ids uuid[];
begin
  select * into s from public.reminder_call_settings where id;

  -- Exactly 7, 3 and 1 day(s) before the expiry date (calendar days, Indian time). A day that was missed is NOT made up later:
  -- the next stage covers it. The window opens and closes at the times in the settings.
  with ins as (
    insert into public.subscription_reminders (event_key, customer_id, service_code, expiry_date, stage, send_after, send_until)
    select 'SUBREM|' || cs.customer_id || '|' || cs.service_code || '|' || cs.renews_on || '|' || (cs.renews_on - v_today),
           cs.customer_id, cs.service_code, cs.renews_on, cs.renews_on - v_today,
           (v_today + s.window_start) at time zone 'Asia/Kolkata', (v_today + s.window_end) at time zone 'Asia/Kolkata'
      from public.customer_services cs
      join public.customers c on c.id = cs.customer_id
     where cs.renews_on - v_today in (7, 3, 1)
       and c.lifecycle_stage = 'CUSTOMER'
       and coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) = 'LIVE'
    on conflict (event_key) do nothing
    returning id)
  select coalesce(array_agg(id), '{}') into v_ids from ins;
  v_new := cardinality(v_ids);
  perform private.sub_reminder_log(x, 'CREATED', null, null, 'Reminder scheduled for ' || v_today) from unnest(v_ids) x;

  -- Reminders that are no longer valid (renewed, date moved, cancelled ...) are withdrawn now, not only when they come due.
  with gone as (
    update public.subscription_reminders sr
       set status = 'CANCELLED', reason = private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date), locked_until = null, updated_at = now()
     where sr.status in ('SCHEDULED', 'RETRY', 'DRY_RUN')
       and private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date) is not null
    returning sr.id, sr.reason)
  select count(*)::int into v_cancelled from (select private.sub_reminder_log(id, 'CANCELLED', null, null, reason) from gone) g;

  insert into public.subscription_reminder_state (key, value, updated_at)
  values ('last_schedule', jsonb_build_object('ranAt', now(), 'day', v_today, 'created', v_new, 'cancelled', v_cancelled), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('day', v_today, 'created', v_new, 'cancelled', v_cancelled);
end $$;
revoke all on function public.sub_reminder_schedule(date) from public, anon, authenticated;
grant execute on function public.sub_reminder_schedule(date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The queue (service role)
-- ---------------------------------------------------------------------------
-- p_mode 'dry_run': claims SCHEDULED / RETRY reminders (they end as DRY_RUN, nothing is dialled).
-- p_mode 'live':    also claims DRY_RUN reminders that are still inside their window.
-- p_now exists for tests; leave it out.
create or replace function public.sub_reminder_claim(p_limit integer default 10, p_mode text default 'dry_run', p_lease_seconds integer default 300, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Asia/Kolkata')::date;
  s public.reminder_call_settings;
  r public.subscription_reminders;
  v_ids uuid[];
  v_why text;
  v_phone text;
  v_consent text;
  v_claimed uuid[] := '{}';
begin
  select * into s from public.reminder_call_settings where id;

  -- A worker that stopped in the middle of a LIVE call attempt may or may not have placed the call: never repeat it, report it.
  -- (A dry-run attempt has no effect, so it simply goes back in the queue.)
  update public.subscription_reminders
     set status = case when p_mode = 'live' then 'FAILED' else 'SCHEDULED' end,
         reason = case when p_mode = 'live' then 'The result was never recorded (the server stopped). Not retried, to avoid calling the customer twice.' else reason end,
         locked_until = null, updated_at = v_now
   where status = 'PROCESSING' and locked_until < v_now;

  -- Withdraw reminders that are no longer valid.
  update public.subscription_reminders sr
     set status = 'CANCELLED', reason = private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date), locked_until = null, updated_at = v_now
   where sr.status in ('SCHEDULED', 'RETRY', 'DRY_RUN') and private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date) is not null;

  -- A reminder whose window has closed is not sent late (and never in a burst the next day).
  update public.subscription_reminders
     set status = 'SKIPPED', reason = 'The call window for this reminder has passed.', locked_until = null, updated_at = v_now
   where status in ('SCHEDULED', 'RETRY') and send_until < v_now;

  select coalesce(array_agg(id), '{}') into v_ids from (
    select sr.id from public.subscription_reminders sr
     where sr.send_after <= v_now and sr.send_until >= v_now
       and ((sr.status in ('SCHEDULED', 'RETRY') and sr.next_attempt_at <= v_now) or (p_mode = 'live' and sr.status = 'DRY_RUN'))
     order by sr.send_after, sr.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;

  for r in select * from public.subscription_reminders where id = any (v_ids) order by send_after, created_at loop
    v_why := null;
    v_phone := private.sub_reminder_phone(r.customer_id);
    select coalesce((select k.status from public.customer_reminder_consent k where k.customer_id = r.customer_id), 'UNKNOWN') into v_consent;
    if v_consent = 'DO_NOT_CALL' then
      v_why := 'The customer asked not to be called.';
    elsif v_consent = 'UNKNOWN' and not s.allow_unknown_consent then
      v_why := 'No call consent is recorded for this customer.';
    elsif v_phone is null then
      v_why := 'The customer has no valid Indian mobile number.';
    end if;
    if v_why is not null then
      update public.subscription_reminders set status = 'SKIPPED', reason = v_why, locked_until = null, updated_at = v_now where id = r.id;
      perform private.sub_reminder_log(r.id, 'SKIPPED', r.attempts, null, v_why);
    else
      update public.subscription_reminders
         set status = 'PROCESSING', attempts = case when r.status = 'DRY_RUN' then 1 else r.attempts + 1 end,
             phone_masked = '+91XXXXXX' || right(v_phone, 4), reason = null, updated_at = v_now,
             locked_until = v_now + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 1800)))
       where id = r.id;
      perform private.sub_reminder_log(r.id, 'ATTEMPT', case when r.status = 'DRY_RUN' then 1 else r.attempts + 1 end, null, 'Claimed (' || p_mode || ')');
      v_claimed := v_claimed || r.id;
    end if;
  end loop;

  -- Only what the caller needs to place the call: no e-mail, no address, no payment data.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', sr.id, 'attempts', sr.attempts, 'stage', sr.stage, 'expiryDate', sr.expiry_date, 'daysLeft', sr.expiry_date - v_today,
             'phone', private.sub_reminder_phone(sr.customer_id), 'customerId', c.id,
             'firstName', split_part(btrim(c.name), ' ', 1), 'lastName', btrim(substr(btrim(c.name), length(split_part(btrim(c.name), ' ', 1)) + 1)),
             'company', c.company, 'serviceCode', sr.service_code, 'serviceName', sv.name, 'planName', cs.plan_name) order by sr.send_after, sr.created_at)
      from public.subscription_reminders sr
      join public.customers c on c.id = sr.customer_id
      left join public.crm_services sv on sv.code = sr.service_code
      left join public.customer_services cs on cs.customer_id = sr.customer_id and cs.service_code = sr.service_code
     where sr.id = any (v_claimed)), '[]'::jsonb);
end $$;
revoke all on function public.sub_reminder_claim(integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_reminder_claim(integer, text, integer, timestamptz) to service_role;

-- ACCEPTED = the provider took the request (it has a call id); it does NOT mean the call happened or was answered.
-- p_now exists for tests; leave it out.
create or replace function public.sub_reminder_finish(p_reminder uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_call_id text default null, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.subscription_reminders;
  v_status text;
  c public.customers;
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_outcome not in ('DRY_RUN', 'ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into r from public.subscription_reminders where id = p_reminder for update;
  if r.id is null or r.status <> 'PROCESSING' then
    raise exception 'CONFLICT: This reminder is not being processed.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and r.attempts >= 3 then 'FAILED' else p_outcome end;
  update public.subscription_reminders
     set status = v_status,
         reason = case when v_status in ('ACCEPTED') then null else left(p_detail, 500) end,
         response_code = p_response_code,
         external_call_id = coalesce(left(p_call_id, 200), external_call_id),
         accepted_at = case when v_status = 'ACCEPTED' then v_now else accepted_at end,
         next_attempt_at = case when v_status = 'RETRY' then v_now + (array[10, 30])[least(r.attempts, 2)] * interval '1 minute' else next_attempt_at end,
         locked_until = null, updated_at = v_now
   where id = r.id returning * into r;
  perform private.sub_reminder_log(r.id, case when v_status = 'ACCEPTED' then 'ACCEPTED' when v_status = 'DRY_RUN' then 'DRY_RUN'
                                              when v_status = 'RETRY' then 'RETRY' when v_status = 'SKIPPED' then 'SKIPPED' else 'FAILED' end,
                                   r.attempts, p_response_code, p_detail);
  if v_status in ('ACCEPTED', 'FAILED') then
    select * into c from public.customers where id = r.customer_id;
    perform private.write_audit(case when v_status = 'ACCEPTED' then 'SUBSCRIPTION_REMINDER_ACCEPTED' else 'SUBSCRIPTION_REMINDER_FAILED' end,
      'subscription_reminder', r.id, c.department_id, c.team_id,
      jsonb_build_object('customer', r.customer_id, 'service', r.service_code, 'stage', r.stage, 'expiry', r.expiry_date, 'attempts', r.attempts));
    perform private.log_customer_activity(r.customer_id, 'AUTOMATION_AI_CALL_' || v_status,
      format('Renewal reminder call (%s day%s before expiry on %s) for %s: %s', r.stage, case when r.stage = 1 then '' else 's' end, r.expiry_date, r.service_code,
             case when v_status = 'ACCEPTED' then 'request accepted by the calling service' else 'could not be placed' end));
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'attempts', r.attempts, 'nextAttemptAt', r.next_attempt_at);
end $$;
revoke all on function public.sub_reminder_finish(uuid, text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_reminder_finish(uuid, text, text, integer, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Staff: consent, the term of a service, settings, and a read-only overview
-- ---------------------------------------------------------------------------
-- Records whether the customer may be called about renewals. ALLOWED needs a note saying how the consent was obtained.
-- UNKNOWN removes the record. Who may: anyone who may update that customer on the Support side.
create or replace function public.set_customer_reminder_consent(p_customer uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if p_status not in ('ALLOWED', 'DO_NOT_CALL', 'UNKNOWN') then
    raise exception 'VALIDATION_ERROR: Choose allowed, do not call, or unknown.' using errcode = 'P0001';
  end if;
  if not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_status = 'ALLOWED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Say how the customer agreed to be called (for example "agreed on the phone on 3 March").' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  if p_status = 'UNKNOWN' then
    delete from public.customer_reminder_consent where customer_id = p_customer;
  else
    insert into public.customer_reminder_consent (customer_id, status, note, changed_by, changed_at)
    values (p_customer, p_status, v_note, auth.uid(), now())
    on conflict (customer_id) do update set status = excluded.status, note = excluded.note, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  end if;
  perform private.write_audit('CUSTOMER_CALL_CONSENT_CHANGED', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('status', p_status));
  perform private.log_customer_activity(p_customer, 'CALL_CONSENT_' || p_status, 'Renewal reminder call consent: ' || p_status || coalesce(' (' || v_note || ')', ''));
  return jsonb_build_object('customerId', p_customer, 'status', p_status);
end $$;
revoke all on function public.set_customer_reminder_consent(uuid, text, text) from public, anon;
grant execute on function public.set_customer_reminder_consent(uuid, text, text) to authenticated;

create or replace function public.customer_reminder_consent_get(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_build_object('status', k.status, 'note', k.note, 'changedAt', k.changed_at) from public.customer_reminder_consent k where k.customer_id = p_customer),
                  jsonb_build_object('status', 'UNKNOWN', 'note', null, 'changedAt', null));
end $$;
revoke all on function public.customer_reminder_consent_get(uuid) from public, anon;
grant execute on function public.customer_reminder_consent_get(uuid) to authenticated;

-- The start date, expiry / renewal date and status of one service of a customer (until now only the Excel import could set them).
-- A value left out (null) is not changed.
create or replace function public.set_customer_service_term(p_customer uuid, p_service text, p_started_on date default null, p_renews_on date default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cs public.customer_services;
  c public.customers;
begin
  if not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('LIVE', 'SETTING_UP', 'PAUSED', 'EXPIRED', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Unknown service status.' using errcode = 'P0001';
  end if;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: The customer does not have this service.' using errcode = 'P0001';
  end if;
  if coalesce(p_renews_on, cs.renews_on) is not null and coalesce(p_started_on, cs.started_on) is not null
     and coalesce(p_renews_on, cs.renews_on) < coalesce(p_started_on, cs.started_on) then
    raise exception 'VALIDATION_ERROR: The expiry date is before the start date.' using errcode = 'P0001';
  end if;
  update public.customer_services
     set started_on = coalesce(p_started_on, started_on), renews_on = coalesce(p_renews_on, renews_on), service_status = coalesce(p_status, service_status)
   where customer_id = p_customer and service_code = p_service returning * into cs;
  select * into c from public.customers where id = p_customer;
  perform private.write_audit('CUSTOMER_SERVICE_TERM_CHANGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'started_on', cs.started_on, 'renews_on', cs.renews_on, 'status', cs.service_status));
  perform private.log_customer_activity(p_customer, 'SERVICE_TERM_CHANGED',
    format('%s: starts %s, renews / expires %s, status %s', p_service, coalesce(cs.started_on::text, '-'), coalesce(cs.renews_on::text, '-'), coalesce(cs.service_status, '-')));
  return jsonb_build_object('customerId', p_customer, 'service', p_service, 'startedOn', cs.started_on, 'renewsOn', cs.renews_on, 'status', cs.service_status);
end $$;
revoke all on function public.set_customer_service_term(uuid, text, date, date, text) from public, anon;
grant execute on function public.set_customer_service_term(uuid, text, date, date, text) to authenticated;

-- Super Admin: the call window and whether customers with no consent record may be called (off by default).
create or replace function public.set_reminder_call_settings(p_window_start time, p_window_end time, p_allow_unknown_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.reminder_call_settings;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change the reminder call settings.' using errcode = '42501';
  end if;
  if p_window_start is null or p_window_end is null or p_allow_unknown_consent is null
     or p_window_start < time '08:00' or p_window_end > time '21:00' or p_window_start >= p_window_end then
    raise exception 'VALIDATION_ERROR: The call window must be between 08:00 and 21:00 and end after it starts.' using errcode = 'P0001';
  end if;
  update public.reminder_call_settings
     set window_start = p_window_start, window_end = p_window_end, allow_unknown_consent = p_allow_unknown_consent, updated_by = auth.uid(), updated_at = now()
   where id returning * into s;
  perform private.write_audit('REMINDER_CALL_SETTINGS_CHANGED', 'reminder_call_settings', null, null, null,
    jsonb_build_object('window_start', s.window_start, 'window_end', s.window_end, 'allow_unknown_consent', s.allow_unknown_consent));
  return jsonb_build_object('windowStart', s.window_start, 'windowEnd', s.window_end, 'allowUnknownConsent', s.allow_unknown_consent);
end $$;
revoke all on function public.set_reminder_call_settings(time, time, boolean) from public, anon;
grant execute on function public.set_reminder_call_settings(time, time, boolean) to authenticated;

-- Super Admin: what the scheduler did. Counts by status and the latest reminders (phone numbers masked).
create or replace function public.sub_reminder_overview(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)));
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can read the reminder calls.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('windowStart', s.window_start, 'windowEnd', s.window_end, 'allowUnknownConsent', s.allow_unknown_consent) from public.reminder_call_settings s where s.id),
    'lastSchedule', (select value from public.subscription_reminder_state where key = 'last_schedule'),
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.subscription_reminders where created_at >= v_since group by status) x), '{}'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'customer', t.name, 'service', t.service_code, 'stage', t.stage, 'expiryDate', t.expiry_date, 'status', t.status,
                                           'attempts', t.attempts, 'reason', t.reason, 'phone', t.phone_masked, 'callId', t.external_call_id, 'updatedAt', t.updated_at)
                       order by t.updated_at desc)
        from (select sr.*, c.name from public.subscription_reminders sr join public.customers c on c.id = sr.customer_id
               where sr.created_at >= v_since order by sr.updated_at desc limit 100) t), '[]'::jsonb));
end $$;
revoke all on function public.sub_reminder_overview(integer) from public, anon;
grant execute on function public.sub_reminder_overview(integer) to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261112000200_paid_only_invoices.sql
-- Paid invoices only, and GST is Accounts' decision.
--
--  1. Sales no longer decides anything about GST. Send to Accounts records the agreed amount only (the basis argument is kept for
--     older callers and ignored). The system never adds GST by itself: the invoice form starts with no GST rate, Accounts chooses it
--     for every line, and the order's total payable is the agreed amount until invoices exist, then the invoices' own totals (with the
--     GST Accounts chose) plus whatever of the agreed amount is not invoiced yet (without GST). Orders made earlier are recalculated
--     the same way below (their invoices are not touched).
--  2. No unpaid invoice is made or sent: saving an invoice creates no PDF and sends no e-mail. "Confirm Payment & Send Paid Invoice"
--     creates the paid invoice (PAID stamp) and e-mails it - also when the confirmed payments cover only part of the order; what is
--     still outstanding stays on the order. A paid invoice needs money that no earlier paid invoice used. (Invoices made before this
--     migration keep their unpaid file; paid_only marks the new ones.)
--
-- Run after 20261111000100_ticket_attachments.sql (safe to run again).

alter table public.generated_invoices add column if not exists paid_only boolean not null default false;
alter table public.generated_invoices alter column paid_only set default true;
-- the confirmed payments of the order at the moment the paid invoice was made
alter table public.generated_invoices add column if not exists paid_order_confirmed numeric(14, 2);

-- An issued invoice stays fixed; only the delivery / payment columns change - now also the order's confirmed amount at the time it was paid
create or replace function private.tg_generated_invoice_immutable()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_open text[] := array['lifecycle', 'payment_confirmed_at', 'payment_confirmed_by', 'payment_method', 'payment_reference', 'payment_note',
    'payment_paid_on', 'updated_at', 'unpaid_pdf_status', 'unpaid_pdf_error', 'unpaid_storage_provider', 'unpaid_storage_bucket',
    'unpaid_storage_path', 'unpaid_storage_ref', 'unpaid_storage_etag', 'unpaid_size_bytes', 'unpaid_stored_at', 'unpaid_email_status',
    'unpaid_email_to', 'unpaid_email_sent_at', 'unpaid_email_error', 'unpaid_email_attempts', 'unpaid_email_message_id', 'unpaid_work_until',
    'paid_pdf_status', 'paid_pdf_error', 'paid_storage_provider', 'paid_storage_bucket', 'paid_storage_path', 'paid_storage_ref',
    'paid_storage_etag', 'paid_size_bytes', 'paid_stored_at', 'paid_email_status', 'paid_email_to', 'paid_email_sent_at', 'paid_email_error',
    'paid_email_attempts', 'paid_email_message_id', 'paid_work_until', 'payment_ledger', 'paid_order_confirmed'];
begin
  if tg_op = 'DELETE' then
    raise exception 'CONFLICT: An issued invoice cannot be deleted.' using errcode = 'P0001';
  end if;
  if (to_jsonb(old) - v_open) is distinct from (to_jsonb(new) - v_open) then
    raise exception 'CONFLICT: An issued invoice cannot be edited. Its number, customer, lines, tax and amounts are fixed.' using errcode = 'P0001';
  end if;
  if old.payment_ledger is not null and new.payment_ledger is distinct from old.payment_ledger then
    raise exception 'CONFLICT: Where the payments of an issued invoice are recorded cannot be changed.' using errcode = 'P0001';
  end if;
  if old.lifecycle = 'PAID' and new.lifecycle <> 'PAID' then
    raise exception 'CONFLICT: A confirmed payment cannot be reversed here.' using errcode = 'P0001';
  end if;
  -- a stored document is never replaced by a different reference
  if old.unpaid_pdf_status = 'STORED' and (new.unpaid_storage_ref is distinct from old.unpaid_storage_ref or new.unpaid_pdf_status <> 'STORED') then
    raise exception 'CONFLICT: The stored unpaid invoice cannot be replaced.' using errcode = 'P0001';
  end if;
  if old.paid_pdf_status = 'STORED' and (new.paid_storage_ref is distinct from old.paid_storage_ref or new.paid_pdf_status <> 'STORED') then
    raise exception 'CONFLICT: The stored paid invoice cannot be replaced.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_generated_invoice_immutable() from public, anon, authenticated;

-- The invoice details, now saying whether the invoice is paid-only
create or replace function private.generated_json(p_invoice uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'number', g.invoice_number, 'invoiceDate', g.invoice_date, 'orderNumber', g.order_number,
    'purpose', g.purpose, 'addonRequestId', g.addon_request_id,
    'customer', jsonb_build_object('name', g.customer_name, 'businessName', g.business_name, 'address', g.business_address,
      'contactPerson', g.contact_person, 'contactNumber', g.contact_number, 'gstin', g.customer_gstin,
      'state', g.customer_state, 'stateCode', g.customer_state_code),
    'taxTreatment', g.tax_treatment, 'taxTreatmentOverridden', g.tax_treatment_overridden, 'taxOverrideReason', g.tax_override_reason,
    'reverseCharge', g.reverse_charge, 'terms', g.terms,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('position', x.position, 'serviceCode', x.service_code, 'particulars', x.particulars,
                         'hsnSac', x.hsn_sac, 'taxRate', x.tax_rate, 'quantity', x.quantity_text, 'baseAmount', x.base_amount,
                         'gstAmount', x.gst_amount, 'totalAmount', x.total_amount) order by x.position)
                         from public.generated_invoice_items x where x.invoice_id = g.invoice_id), '[]'::jsonb),
    'totals', jsonb_build_object('subtotal', g.subtotal, 'cgstRate', g.cgst_rate, 'cgstAmount', g.cgst_amount,
      'sgstRate', g.sgst_rate, 'sgstAmount', g.sgst_amount, 'igstRate', g.igst_rate, 'igstAmount', g.igst_amount,
      'totalGst', g.total_gst, 'total', g.total_amount, 'inWords', g.amount_in_words, 'breakdown', g.tax_breakdown),
    'lifecycle', g.lifecycle, 'paidOnly', g.paid_only,
    'paymentSummary', private.invoice_payment_summary(g.invoice_id),
    'payment', case when g.lifecycle = 'PAID' then jsonb_build_object('confirmedAt', g.payment_confirmed_at,
      'confirmedBy', (select full_name from public.profiles where id = g.payment_confirmed_by),
      'method', g.payment_method, 'reference', g.payment_reference, 'note', g.payment_note, 'paidOn', g.payment_paid_on) end,
    'unpaid', jsonb_build_object('pdfStatus', g.unpaid_pdf_status, 'pdfError', g.unpaid_pdf_error, 'sizeBytes', g.unpaid_size_bytes,
      'storedAt', g.unpaid_stored_at, 'emailStatus', g.unpaid_email_status, 'emailTo', g.unpaid_email_to, 'emailSentAt', g.unpaid_email_sent_at,
      'emailError', g.unpaid_email_error, 'emailAttempts', g.unpaid_email_attempts, 'busy', coalesce(g.unpaid_work_until > now(), false)),
    'paid', jsonb_build_object('pdfStatus', g.paid_pdf_status, 'pdfError', g.paid_pdf_error, 'sizeBytes', g.paid_size_bytes,
      'storedAt', g.paid_stored_at, 'emailStatus', g.paid_email_status, 'emailTo', g.paid_email_to, 'emailSentAt', g.paid_email_sent_at,
      'emailError', g.paid_email_error, 'emailAttempts', g.paid_email_attempts, 'busy', coalesce(g.paid_work_until > now(), false)))
  from public.generated_invoices g where g.invoice_id = p_invoice
$$;
revoke all on function private.generated_json(uuid) from public, anon, authenticated;


-- The total payable of an order (agreed amount, GST decided by Accounts): the invoices' totals plus the agreed amount not invoiced yet.
create or replace function private.sync_order_payable(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_gross numeric; v_new numeric;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or c.agreed_amount is null or c.agreed_tax_basis <> 'EXCLUSIVE' then
    return;
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_amount), 0) into v_net, v_gross
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  -- no GST is assumed for the part that is not invoiced yet: Accounts decides it when it makes that invoice
  v_new := round(v_gross + greatest(c.agreed_amount - v_net, 0), 2);
  -- never below what has already been received
  v_new := greatest(v_new, c.amount_received);
  if c.deal_amount is distinct from v_new then
    update public.customers set deal_amount = v_new where id = c.id;
  end if;
end $$;
revoke all on function private.sync_order_payable(uuid) from public, anon, authenticated;

create or replace function public.accounts_invoice_claim(p_invoice uuid, p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_stage text := upper(coalesce(p_stage, ''));
  g public.generated_invoices;
  inv public.member_invoices;
  c public.customers;
  v_pdf text; v_mail text; v_until timestamptz;
  v_snapshot jsonb;
begin
  perform private.require_accounts_staff();
  if v_stage not in ('UNPAID', 'PAID') then
    raise exception 'VALIDATION_ERROR: Choose the unpaid or the paid invoice.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = p_invoice for update;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into inv from public.member_invoices where id = p_invoice;
  if v_stage = 'PAID' and g.lifecycle <> 'PAID' then
    raise exception 'CONFLICT: Confirm the payment first.' using errcode = 'P0001';
  end if;
  if v_stage = 'UNPAID' and g.paid_only then
    raise exception 'CONFLICT: Unpaid invoices are not sent to customers. The paid invoice is created and e-mailed when the payment is confirmed.' using errcode = 'P0001';
  end if;
  v_pdf := case when v_stage = 'UNPAID' then g.unpaid_pdf_status else g.paid_pdf_status end;
  v_mail := case when v_stage = 'UNPAID' then g.unpaid_email_status else g.paid_email_status end;
  v_until := case when v_stage = 'UNPAID' then g.unpaid_work_until else g.paid_work_until end;
  select * into c from public.customers where id = g.customer_id;
  -- `stored` (where the PDF already is, when it is) lets a retry e-mail the file that was stored instead of drawing a second one.
  -- It is for Accounts only and never part of the invoice JSON other people read.
  v_snapshot := private.generated_json(g.invoice_id) || jsonb_build_object('paymentSummary', private.invoice_payment_summary(g.invoice_id), 'invoiceId', g.invoice_id, 'customerId', g.customer_id, 'issuedAt', g.issued_at, 'stage', v_stage, 'recipientEmail', c.email,
    'stored', case when v_pdf <> 'STORED' then null
                   when v_stage = 'UNPAID' then jsonb_build_object('provider', g.unpaid_storage_provider, 'bucket', g.unpaid_storage_bucket,
                                                                    'path', g.unpaid_storage_path, 'sizeBytes', g.unpaid_size_bytes, 'etag', g.unpaid_storage_etag)
                   else jsonb_build_object('provider', g.paid_storage_provider, 'bucket', g.paid_storage_bucket,
                                           'path', g.paid_storage_path, 'sizeBytes', g.paid_size_bytes, 'etag', g.paid_storage_etag) end);

  if v_pdf = 'STORED' and v_mail = 'SENT' then
    return jsonb_build_object('claimed', false, 'reason', 'DONE', 'invoice', v_snapshot);
  end if;
  if v_until is not null and v_until > now() then
    return jsonb_build_object('claimed', false, 'reason', 'BUSY', 'invoice', v_snapshot);
  end if;
  if v_stage = 'UNPAID' then
    update public.generated_invoices set unpaid_work_until = now() + interval '3 minutes' where invoice_id = g.invoice_id;
  else
    update public.generated_invoices set paid_work_until = now() + interval '3 minutes' where invoice_id = g.invoice_id;
  end if;
  return jsonb_build_object('claimed', true, 'reason', null, 'invoice', v_snapshot);
end $$;
revoke all on function public.accounts_invoice_claim(uuid, text) from public, anon;
grant execute on function public.accounts_invoice_claim(uuid, text) to authenticated;

create or replace function public.accounts_confirm_invoice_payment(
  p_invoice uuid, p_method text default null, p_reference text default null, p_note text default null, p_paid_on date default null,
  p_amount numeric default null, p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
  g public.generated_invoices;
  c public.customers;
  r public.addon_requests;
  s jsonb;
  v_method text := upper(coalesce(nullif(btrim(p_method), ''), ''));
  v_ref text := nullif(left(btrim(coalesce(p_reference, '')), 120), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_balance numeric;
  v_amount numeric;
  v_paid_on date;
  v_last_method text; v_last_ref text; v_last_on date;
  v_recorded boolean := false;
  v_threshold numeric;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null or inv.kind <> 'GENERATED' then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = inv.id for update;
  -- a repeated click or request: the payment was confirmed once already; nothing more is recorded
  if g.lifecycle = 'PAID' then
    return private.invoice_json(inv) || jsonb_build_object('replayed', true, 'settled', true);
  end if;
  select * into c from public.customers where id = g.customer_id for update;
  s := private.invoice_payment_summary(inv.id);
  v_balance := (s ->> 'balance')::numeric;

  if g.payment_ledger = 'INVOICE' then
    -- the same request again (a retry after a timeout): the payment is already on record
    if p_request is not null and exists (select 1 from public.invoice_payments where request_id = p_request) then
      s := private.invoice_payment_summary(inv.id);
      v_balance := (s ->> 'balance')::numeric;
    elsif v_balance > 0 or p_amount is not null then
      v_amount := coalesce(p_amount, v_balance);
      if v_amount <= 0 or v_amount <> round(v_amount, 2) then
        raise exception 'VALIDATION_ERROR: Enter the amount received in rupees (more than zero, up to 2 decimals).' using errcode = 'P0001';
      end if;
      if v_amount > v_balance then
        raise exception 'VALIDATION_ERROR: The amount is more than the balance of this invoice (%).', private.rupees(v_balance) using errcode = 'P0001';
      end if;
      if v_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
        raise exception 'VALIDATION_ERROR: Choose how the payment was received.' using errcode = 'P0001';
      end if;
      if v_method in ('UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE') and v_ref is null then
        raise exception 'VALIDATION_ERROR: Enter the transaction / reference number.' using errcode = 'P0001';
      end if;
      v_paid_on := coalesce(p_paid_on, v_today);
      if v_paid_on > v_today or v_paid_on < g.invoice_date then
        raise exception 'VALIDATION_ERROR: The payment date cannot be in the future or before the invoice date.' using errcode = 'P0001';
      end if;
      begin
        insert into public.invoice_payments (invoice_id, customer_id, request_id, payment_type, amount, method, reference, paid_on, note, recorded_by)
        values (inv.id, g.customer_id, p_request, case when v_amount = v_balance then 'FULL' else 'PART' end, v_amount, v_method, v_ref,
                v_paid_on, v_note, (select private.my_id()));
      exception when unique_violation then
        raise exception 'CONFLICT: A payment with this reference is already recorded for this invoice.' using errcode = 'P0001';
      end;
      v_recorded := true;
      s := private.invoice_payment_summary(inv.id);
      v_balance := (s ->> 'balance')::numeric;
      perform private.log_customer_activity(c.id, 'INVOICE_PAYMENT_RECORDED',
        format('%s received for invoice %s (balance %s)', private.rupees(v_amount), inv.invoice_number, private.rupees(v_balance)));
      perform private.write_audit('INVOICE_PAYMENT_RECORDED', 'invoice', inv.id, c.department_id, c.team_id,
        jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'amount', v_amount, 'balance', v_balance, 'method', v_method, 'reference', v_ref));
    end if;
  elsif p_amount is not null then
    raise exception 'CONFLICT: The payments of this invoice are recorded in Payments (or Business Verification for an add-on). Record and verify them there, then confirm here.' using errcode = 'P0001';
  end if;

  if g.payment_ledger = 'CUSTOMER' then
    -- The agreed services: the paid invoice (with the PAID stamp) can be sent as soon as a payment of the order is verified, also
    -- when it covers only part of the order. What is still outstanding stays on the order (Payments). Each paid invoice needs
    -- money that no earlier paid invoice already used.
    select greatest(coalesce(max(o.paid_order_confirmed), 0), coalesce(sum(o.total_amount) filter (where o.paid_order_confirmed is null), 0))
      into v_threshold
      from public.generated_invoices o
     where o.customer_id = g.customer_id and o.payment_ledger = 'CUSTOMER' and o.lifecycle = 'PAID' and o.invoice_id <> g.invoice_id;
    if coalesce(c.amount_verified, 0) <= 0 then
      raise exception 'CONFLICT: No payment is confirmed yet. Record and verify the payment in Payments, then confirm it here.' using errcode = 'P0001';
    elsif c.amount_verified <= v_threshold then
      raise exception 'CONFLICT: The confirmed payments (%) are already covered by the paid invoices. Record and verify the new payment in Payments first.', private.rupees(c.amount_verified) using errcode = 'P0001';
    end if;
  elsif v_balance > 0 then
    if g.payment_ledger <> 'INVOICE' then
      raise exception 'CONFLICT: % of % is confirmed. Record and verify the remaining % in %, then confirm the payment here.',
        private.rupees((s ->> 'confirmed')::numeric), private.rupees(g.total_amount), private.rupees(v_balance),
        case when g.payment_ledger = 'ADDON' then 'Business Verification' else 'Payments' end using errcode = 'P0001';
    end if;
    -- a part payment: recorded, the invoice stays open with its balance
    perform private.notify(c.owner_id, 'INVOICE_PART_PAYMENT', format('Part payment: %s', coalesce(c.company, c.name)),
      format('%s received for invoice %s. Balance %s.', private.rupees(v_amount), inv.invoice_number, private.rupees(v_balance)), 'customer', c.id);
    select * into inv from public.member_invoices where id = p_invoice;
    return private.invoice_json(inv) || jsonb_build_object('replayed', not v_recorded, 'settled', false);
  end if;

  -- fully covered: mark paid and open the paid stage
  if inv.addon_request_id is not null then
    select * into r from public.addon_requests where id = inv.addon_request_id for update;
    if r.status = 'INVOICE_GENERATED' then
      perform public.accounts_confirm_addon_payment(r.id, v_note);
    end if;
    select * into inv from public.member_invoices where id = p_invoice;
    if inv.status <> 'Paid' then
      raise exception 'CONFLICT: The add-on payment is not confirmed yet.' using errcode = 'P0001';
    end if;
  else
    update public.member_invoices
       set status = 'Paid', paid_at = coalesce(paid_at, now()), status_source = 'MANUAL'
     where id = inv.id returning * into inv;
  end if;
  -- how the (last) payment was made, for the paid invoice: Accounts' entry, or the last verified payment on record
  if v_method = '' or not v_recorded then
    select pay.method, pay.reference, pay.paid_on into v_last_method, v_last_ref, v_last_on from (
      select method, reference, paid_at::date as paid_on, recorded_at from public.customer_payments where g.payment_ledger = 'CUSTOMER' and customer_id = g.customer_id and status = 'VERIFIED'
      union all
      select method, reference, paid_at::date, recorded_at from public.addon_payments where g.payment_ledger = 'ADDON' and request_id = inv.addon_request_id and status = 'VERIFIED'
      union all
      select method, reference, paid_on, recorded_at from public.invoice_payments where g.payment_ledger = 'INVOICE' and invoice_id = inv.id and status = 'VERIFIED'
      order by recorded_at desc limit 1) pay;
  end if;
  update public.generated_invoices
     set payment_method = coalesce(nullif(v_method, ''), v_last_method), payment_reference = coalesce(v_ref, v_last_ref), payment_note = v_note,
         payment_paid_on = coalesce(p_paid_on, v_last_on, v_today),
         paid_order_confirmed = case when g.payment_ledger = 'CUSTOMER' then c.amount_verified end
   where invoice_id = g.invoice_id;
  perform private.log_customer_activity(c.id, 'INVOICE_PAYMENT_CONFIRMED', format('Payment of invoice %s confirmed by Accounts', inv.invoice_number));
  perform private.write_audit('INVOICE_PAYMENT_CONFIRMED', 'invoice', inv.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'total', inv.amount, 'method', v_method, 'reference', v_ref, 'ledger', g.payment_ledger));
  perform private.notify(c.owner_id, 'INVOICE_PAID', format('Payment confirmed: %s', coalesce(c.company, c.name)),
    format('Accounts confirmed the payment of invoice %s (%s).', inv.invoice_number, private.rupees(inv.amount)), 'customer', c.id);
  select * into inv from public.member_invoices where id = p_invoice;
  return private.invoice_json(inv) || jsonb_build_object('replayed', false, 'settled', true);
end $$;
revoke all on function public.accounts_confirm_invoice_payment(uuid, text, text, text, date, numeric, uuid) from public, anon;
grant execute on function public.accounts_confirm_invoice_payment(uuid, text, text, text, date, numeric, uuid) to authenticated;

-- Sales: Send to Accounts records the agreed amount only
create or replace function public.send_lead_to_accounts(p_customer uuid, p_amount numeric, p_note text default null, p_tax_basis text default 'INCLUSIVE')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_basis text := 'EXCLUSIVE'; -- Sales never decides about GST: Accounts adds it, line by line, when it makes the invoice (p_tax_basis is ignored)
  v_request uuid;
  v_payable numeric;
begin
  if v_basis not in ('INCLUSIVE', 'EXCLUSIVE') then
    raise exception 'VALIDATION_ERROR: Say whether the agreed amount includes or excludes GST.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage <> 'LEAD' then
    raise exception 'CONFLICT: Only leads can be sent to Accounts.' using errcode = 'P0001';
  end if;
  if v.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' or exists (
       select 1 from public.payment_requests r where r.customer_id = p_customer and r.status = 'PENDING') then
    raise exception 'CONFLICT: This lead is already with Accounts for payment confirmation.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customer_services s where s.customer_id = p_customer) then
    raise exception 'VALIDATION_ERROR: Select at least one service before sending to Accounts.' using errcode = 'P0001';
  end if;
  if v.phone is null and v.email is null then
    raise exception 'VALIDATION_ERROR: Add a phone number or e-mail before sending to Accounts.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the agreed amount.' using errcode = 'P0001';
  end if;
  if p_amount <> trunc(p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the agreed amount in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if v_basis = 'INCLUSIVE' and p_amount < v.amount_received then
    raise exception 'VALIDATION_ERROR: The agreed amount cannot be less than the % already recorded.', private.rupees(v.amount_received) using errcode = 'P0001';
  end if;

  insert into public.payment_requests (customer_id, agreed_amount, sales_note, requested_by)
  values (p_customer, p_amount, v_note, (select private.my_id()))
  returning id into v_request;
  -- deal_amount is what the customer has to pay in total: the agreed amount until Accounts invoices it, then the invoices' own totals
  -- (with the GST Accounts chose). Every payment, balance and status rule keeps reading it. agreed_amount keeps what Sales agreed.
  update public.customers
     set payment_workflow = 'PENDING_PAYMENT_CONFIRMATION', deal_amount = p_amount, agreed_amount = p_amount, agreed_tax_basis = v_basis,
         lead_status = 'READY_TO_BUY'
   where id = p_customer;
  perform private.sync_order_payable(p_customer);
  select deal_amount into v_payable from public.customers where id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_ACCOUNTS',
    format('Sent to Accounts for payment confirmation (agreed %s)', private.rupees(p_amount)) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('PAYMENT_SENT_TO_ACCOUNTS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', v_request, 'agreed_amount', p_amount, 'tax_basis', v_basis, 'payable', v_payable, 'note', v_note));
  perform private.notify_accounts('PAYMENT_CONFIRMATION_REQUESTED', format('Confirm payment: %s', coalesce(v.company, v.name)),
    format('Sales sent a customer for payment confirmation (agreed %s).', private.rupees(p_amount)), p_customer);
  return v_request;
end $$;
revoke all on function public.send_lead_to_accounts(uuid, numeric, text, text) from public, anon;
grant execute on function public.send_lead_to_accounts(uuid, numeric, text, text) to authenticated;

-- Accounts: the invoice form starts without a GST rate
create or replace function public.accounts_invoice_prefill(p_customer uuid, p_purpose text default 'SERVICES', p_addon_request uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  r public.addon_requests;
  prev public.generated_invoices;
  v_purpose text := upper(coalesce(nullif(btrim(p_purpose), ''), 'SERVICES'));
  v_name text; v_business text; v_address text; v_contact text; v_mobile text; v_gstin text; v_state text;
  v_src_business text := 'NONE'; v_src_address text := 'NONE'; v_src_contact text := 'NONE'; v_src_mobile text := 'NONE';
  v_src_gstin text := 'NONE'; v_src_state text := 'NONE';
  v_lines jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_next bigint; v_last bigint; v_called boolean; v_suggest text;
  v_treatment text;
  v_invoiced numeric := 0;
  v_invoiced_net numeric := 0;
  v_excl boolean;
  v_left_net numeric;
begin
  perform private.require_accounts_staff();
  if p_customer is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_purpose not in ('SERVICES', 'ADDON', 'ADDITIONAL') then
    raise exception 'VALIDATION_ERROR: Choose what this invoice is for.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  v_excl := c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE';

  -- Business name / address / contact / mobile: what was collected in onboarding first (the onboarding cards and the customer
  -- record are kept in step, so they normally agree), then the customer record. Nothing is invented.
  select nullif(btrim(e.value), '') into v_business from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'BUSINESS_NAME' and e.status in ('SAVED', 'VERIFIED');
  if v_business is not null then v_src_business := 'ONBOARDING';
  else
    v_business := nullif(btrim(c.company), '');
    if v_business is not null then v_src_business := 'CUSTOMER'; end if;
  end if;
  select nullif(btrim(e.value), '') into v_address from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'BUSINESS_ADDRESS' and e.status in ('SAVED', 'VERIFIED');
  if v_address is not null then v_src_address := 'ONBOARDING';
  else
    v_address := nullif(btrim(c.address), '');
    if v_address is not null then v_src_address := 'CUSTOMER'; end if;
  end if;
  select nullif(btrim(e.value), '') into v_contact from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'CUSTOMER_NAME' and e.status in ('SAVED', 'VERIFIED');
  if v_contact is not null then v_src_contact := 'ONBOARDING';
  else
    v_contact := nullif(btrim(c.name), '');
    if v_contact is not null then v_src_contact := 'CUSTOMER'; end if;
  end if;
  v_name := coalesce(nullif(btrim(c.name), ''), v_contact);
  v_mobile := nullif(btrim(c.phone), '');
  if v_mobile is not null then
    v_src_mobile := 'CUSTOMER';
  else
    select nullif(btrim(e.value), '') into v_mobile from public.customer_onboarding_entries e
     where e.customer_id = c.id and e.item_code = 'CUSTOMER_MOBILE' and e.status in ('SAVED', 'VERIFIED');
    if v_mobile is not null then v_src_mobile := 'ONBOARDING'; end if;
  end if;

  -- GSTIN: there is no structured GST field on the customer, so the only structured source is the customer's own previous
  -- invoice. Otherwise it stays blank for Accounts to enter (no extraction from uploaded documents).
  select * into prev from public.generated_invoices g where g.customer_id = c.id order by g.issued_at desc limit 1;
  if prev.invoice_id is not null and prev.customer_gstin is not null then
    v_gstin := prev.customer_gstin;
    v_src_gstin := 'PREVIOUS_INVOICE';
  end if;
  -- State: the address first, then the GSTIN prefix, then the previous invoice. When two of these disagree Accounts is warned.
  v_state := private.infer_state_code(v_address);
  if v_state is not null then
    v_src_state := 'ADDRESS';
  elsif v_gstin is not null and private.valid_gstin(v_gstin) then
    v_state := left(v_gstin, 2);
    v_src_state := 'GSTIN';
  elsif prev.invoice_id is not null then
    v_state := prev.customer_state_code;
    v_src_state := 'PREVIOUS_INVOICE';
  end if;
  if v_state is not null and v_gstin is not null and private.valid_gstin(v_gstin) and left(v_gstin, 2) <> v_state then
    v_warnings := v_warnings || to_jsonb(format('The address says %s but the GSTIN starts with %s (%s). Verify the state before issuing.',
      (select name from public.gst_states where code = v_state), left(v_gstin, 2), (select name from public.gst_states where code = left(v_gstin, 2))));
  end if;
  if v_state is null then
    v_warnings := v_warnings || to_jsonb('The customer''s state could not be worked out. Choose it so the right tax is applied.'::text);
  end if;
  if v_address is null then
    v_warnings := v_warnings || to_jsonb('The customer has no business address on record. Enter it before issuing.'::text);
  end if;
  if c.email is null then
    v_warnings := v_warnings || to_jsonb('The customer has no e-mail address, so the invoice cannot be e-mailed. Add it to the customer first.'::text);
  end if;
  v_treatment := case when v_state is null then null when v_state = private.company_state_code() then 'INTRA_STATE' else 'INTER_STATE' end;

  -- The services of THIS purchase, each once.
  if v_purpose = 'SERVICES' then
    -- A new agreement carries no GST: the rate is left for Accounts to choose (null). Only an older agreement that already includes
    -- GST keeps the 18% its amounts were worked out with.
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', s.code, 'particulars', s.name, 'hsnSac', '998313', 'taxRate', case when v_excl then 0 else 18 end,
                                                  'quantity', '1 Nos', 'baseAmount', null) order by s.sort_order, s.name), '[]'::jsonb)
      into v_lines
      from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id;
    -- An invoice can be made for each part payment. When the agreement excludes GST the amounts before GST are compared with it
    -- (the GST is added on top); otherwise the invoice totals with GST are compared with the agreed amount.
    select coalesce(sum(g.subtotal), 0), coalesce(sum(g.total_amount), 0) into v_invoiced_net, v_invoiced
      from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES';
    if v_invoiced > 0 then
      v_warnings := v_warnings || to_jsonb(
        case when v_excl
             then format('Invoices already issued for the agreed services total %s before GST (%s with GST) of the agreed %s excluding GST. This invoice can cover the rest.',
                         private.rupees(v_invoiced_net), private.rupees(v_invoiced), private.rupees(c.agreed_amount))
             else format('Invoices already issued for the agreed services total %s%s. This invoice, for the next payment, can cover the rest.',
                         private.rupees(v_invoiced), case when coalesce(c.deal_amount, 0) > 0 then format(' of the agreed %s (including GST)', private.rupees(c.deal_amount)) else '' end) end);
    end if;
    -- The amount comes from this customer's own record: what Sales agreed for the services, less what has already been
    -- invoiced for them, spread over the services of the purchase (so the invoices together never pass the agreed amount).
    if v_excl then
      v_left_net := c.agreed_amount - v_invoiced_net;
      if v_left_net > 0 then
        -- the amounts are before GST: the balance is spread over the services as it is (no GST is added here)
        v_lines := private.spread_invoice_total(v_lines, v_left_net);
      else
        v_warnings := v_warnings || to_jsonb(format('The agreed %s (excluding GST) has already been invoiced in full, so no amount is filled in.', private.rupees(c.agreed_amount)));
      end if;
    elsif coalesce(c.deal_amount, 0) > 0 then
      if c.deal_amount - v_invoiced > 0 then
        v_lines := private.spread_invoice_total(v_lines, c.deal_amount - v_invoiced);
      else
        v_warnings := v_warnings || to_jsonb(format('The agreed %s has already been invoiced in full, so no amount is filled in.', private.rupees(c.deal_amount)));
      end if;
    end if;
    if v_excl then
      -- the GST rate is Accounts' decision, line by line
      select coalesce(jsonb_agg((l.line - 'taxRate') || jsonb_build_object('taxRate', null) order by l.ord), '[]'::jsonb) into v_lines
        from jsonb_array_elements(v_lines) with ordinality as l(line, ord);
    end if;
  elsif v_purpose = 'ADDON' then
    if p_addon_request is not null then
      select * into r from public.addon_requests where id = p_addon_request and customer_id = c.id;
    else
      select * into r from public.addon_requests where customer_id = c.id and status = 'APPROVED' order by created_at desc limit 1;
    end if;
    if r.id is null or r.status <> 'APPROVED' then
      raise exception 'CONFLICT: There is no approved add-on request waiting for an invoice for this customer.' using errcode = 'P0001';
    end if;
    -- the approved prices: base = quantity x unit price - discount, with the tax the request was approved with
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', i.service_code, 'particulars', i.name, 'hsnSac', '998313',
                                                  'taxRate', i.tax_percent, 'quantity', format('%s Nos', i.quantity),
                                                  'baseAmount', i.quantity * i.unit_price - i.discount) order by i.sort_order), '[]'::jsonb)
      into v_lines from public.addon_request_items i where i.request_id = r.id;
  end if;

  select last_value, is_called into v_last, v_called from public.invoice_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;
  loop
    v_suggest := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_next::text, 5, '0');
    exit when not exists (select 1 from public.member_invoices where lower(invoice_number) = lower(v_suggest));
    v_next := v_next + 1;
  end loop;

  return jsonb_build_object(
    'customerId', c.id, 'customerCode', c.customer_code, 'purpose', v_purpose, 'addonRequestId', r.id,
    'customer', jsonb_build_object('name', v_name, 'businessName', v_business, 'address', v_address, 'contactPerson', v_contact,
      'contactNumber', v_mobile, 'gstin', v_gstin, 'stateCode', v_state,
      'state', (select name from public.gst_states where code = v_state)),
    'sources', jsonb_build_object('businessName', v_src_business, 'address', v_src_address, 'contactPerson', v_src_contact,
      'contactNumber', v_src_mobile, 'gstin', v_src_gstin, 'state', v_src_state),
    'recipientEmail', c.email,
    'taxTreatment', v_treatment,
    'company', jsonb_build_object('name', 'Amuwa Corporation', 'stateCode', private.company_state_code(), 'gstin', private.company_gstin()),
    'suggestedInvoiceNumber', v_suggest,
    'invoiceDate', (now() at time zone 'Asia/Kolkata')::date,
    'orderNumber', 'Verbal', 'terms', '100% Payment Against supply.',
    'lines', v_lines,
    'dealAmount', c.deal_amount,
    'servicesInvoiced', (select coalesce(sum(g.total_amount), 0) from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES'),
    'servicesInvoicedTaxable', (select coalesce(sum(g.subtotal), 0) from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES'),
    'agreedAmount', coalesce(c.agreed_amount, c.deal_amount),
    'agreedTaxBasis', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end,
    'order', private.order_summary(c.id),
    'addonTotal', r.total,
    'existingInvoices', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.invoice_number, 'kind', x.kind, 'status', x.status, 'total', x.amount)
                                    order by x.created_at desc)
                                   from (select * from public.member_invoices i where i.customer_id = c.id and i.kind <> 'MANUAL'
                                          order by i.created_at desc limit 10) x), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'category', s.category) order by s.sort_order, s.name)
                           from public.crm_services s where s.is_active), '[]'::jsonb),
    'warnings', v_warnings);
end $$;
revoke all on function public.accounts_invoice_prefill(uuid, text, uuid) from public, anon;
grant execute on function public.accounts_invoice_prefill(uuid, text, uuid) to authenticated;

-- Orders made before this migration carried an estimated 18% GST on the part not invoiced yet: recalculate them (invoices untouched).
do $$
declare r record;
begin
  for r in select id from public.customers where agreed_amount is not null and agreed_tax_basis = 'EXCLUSIVE' loop
    perform private.sync_order_payable(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261112000300_company_workflow.sql
-- =============================================================================
-- Company workflow (Super Admin): the whole company as one diagram.
--
--   company_workflow()   Super Admin only. Returns, read from the live tables:
--     * departments, their teams (sub-departments, with the Sales / Support / General division),
--       the Department Heads, Team Leads and members of each (names, roles and job titles only);
--     * the hand-offs that already exist in the CRM, each with the number of records that went through it:
--         Sales/Support -> Accounts (Send to Accounts), Accounts -> back to the team (payment confirmed / returned),
--         team -> Technical Consultant, Technical Consultant -> Department Head -> Team Lead -> Team Member,
--         team -> delivery department (services that skip the consultant), support ticket escalation,
--         Department Head -> Team Lead tasks, leave approval Department Head -> HR, add-ons -> Accounts.
--   Nothing is typed into the diagram: a new department, team, person or reassignment shows up on the next read, and a
--   hand-off is only returned when both ends exist (no consultant in a department, no consultant hand-off).
--   No e-mail, phone, password or token is returned.
-- Run after 20261112000200_paid_only_invoices.sql. Safe to run again.
-- =============================================================================

create or replace function public.company_workflow()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_accounts uuid;
  v_hr uuid;
  v_departments jsonb;
  v_teams jsonb;
  v_heads jsonb;
  v_members jsonb;
  v_handoffs jsonb := '[]'::jsonb;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can see the company workflow.' using errcode = '42501';
  end if;

  select id into v_accounts from public.departments where slug = 'accounts';
  select id into v_hr from public.departments where slug = 'hr';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name, 'category', d.category, 'description', d.description,
           'accent', d.accent_color, 'locked', d.is_locked, 'generatesRevenue', d.generates_revenue,
           'staff', (select count(*) from public.profiles p where p.department_id = d.id and p.status = 'ACTIVE'),
           'customers', (select count(*) from public.customers c where c.department_id = d.id)
         ) order by d.name), '[]'::jsonb)
    into v_departments from public.departments d;

  -- teams are the sub-departments
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'departmentId', t.department_id, 'name', t.name, 'division', t.division,
           'leadCount', (select count(*) from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'),
           'memberCount', (select count(*) from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER'),
           'consultantCount', (select count(*) from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE' and p.is_technical_consultant),
           'customers', (select count(*) from public.customers c where c.team_id = t.id)
         ) order by t.name), '[]'::jsonb)
    into v_teams from public.teams t;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'departmentId', p.department_id) order by p.full_name), '[]'::jsonb)
    into v_heads from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE' and p.department_id is not null;

  -- people: name, role and title only
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.full_name, 'role', p.role, 'title', p.position, 'teamId', p.team_id, 'departmentId', p.department_id,
           'consultant', coalesce(p.is_technical_consultant, false)) order by p.role, p.full_name), '[]'::jsonb)
    into v_members from public.profiles p
   where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.team_id is not null;

  -- 1. Sales / Support -> Accounts: "Send to Accounts" (payment confirmation)
  if v_accounts is not null then
    v_handoffs := v_handoffs || coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 'to-accounts:' || t.id, 'process', 'payment',
               'from', jsonb_build_object('kind', 'team', 'id', t.id), 'to', jsonb_build_object('kind', 'department', 'id', v_accounts),
               'label', 'Send to Accounts', 'hint', 'Payment is recorded and verified by Accounts',
               'count', coalesce(r.n, 0), 'countLabel', 'waiting for Accounts') order by t.name)
        from public.teams t
        left join (select c.team_id, count(*) n from public.payment_requests pr join public.customers c on c.id = pr.customer_id
                    where pr.status = 'PENDING' group by c.team_id) r on r.team_id = t.id
       where t.division in ('SALES', 'SUPPORT') and t.department_id <> v_accounts), '[]'::jsonb);

    -- 2. Accounts -> back to the team: payment confirmed / returned
    v_handoffs := v_handoffs || coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 'from-accounts:' || t.id, 'process', 'payment',
               'from', jsonb_build_object('kind', 'department', 'id', v_accounts), 'to', jsonb_build_object('kind', 'team', 'id', t.id),
               'label', 'Confirm payment and return', 'hint', 'The same customer goes on to onboarding; or back to leads with a reason',
               'count', coalesce(r.confirmed, 0), 'countLabel', 'confirmed', 'extra', jsonb_build_object('returned', coalesce(r.returned, 0))) order by t.name)
        from public.teams t
        left join (select c.team_id,
                          count(*) filter (where c.payment_workflow = 'PAYMENT_CONFIRMED') confirmed,
                          count(*) filter (where c.payment_workflow = 'RETURNED_FROM_ACCOUNTS') returned
                     from public.customers c group by c.team_id) r on r.team_id = t.id
       where t.division in ('SALES', 'SUPPORT') and t.department_id <> v_accounts), '[]'::jsonb);

    -- 3. Technical Consultant -> Accounts: add-on (extra service) price verification and payment
    v_handoffs := v_handoffs || coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 'addon:' || t.id, 'process', 'addon',
               'from', jsonb_build_object('kind', 'consultants', 'id', t.id), 'to', jsonb_build_object('kind', 'department', 'id', v_accounts),
               'label', 'Add-on to Accounts', 'hint', 'A client asked for another service: Accounts verifies the price and the payment',
               'count', coalesce(r.n, 0), 'countLabel', 'in the add-on workflow') order by t.name)
        from public.teams t
        left join (select c.department_id, count(*) n from public.service_requests sr join public.customers c on c.id = sr.customer_id
                    where sr.status = 'IN_ADDON_WORKFLOW' group by c.department_id) r on r.department_id = t.department_id
       where t.division = 'SUPPORT' and t.department_id <> v_accounts
         and exists (select 1 from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE' and p.is_technical_consultant)), '[]'::jsonb);
  end if;

  -- 4. Sales / Support -> Technical Consultant (only where the department has consultants)
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'to-consultant:' || s.id || ':' || k.id, 'process', 'onboarding',
             'from', jsonb_build_object('kind', 'team', 'id', s.id), 'to', jsonb_build_object('kind', 'consultants', 'id', k.id),
             'label', 'Send to Technical Consultant', 'hint', 'Documents are saved, then reviewed and authorized by the consultant',
             'count', coalesce(r.n, 0), 'countLabel', 'with the consultant') order by s.name)
      from public.teams s
      join public.teams k on k.department_id = s.department_id and k.division = 'SUPPORT'
                         and exists (select 1 from public.profiles p where p.team_id = k.id and p.status = 'ACTIVE' and p.is_technical_consultant)
      left join (select c.team_id, count(*) n from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                  where o.with_consultant and o.handover_stage = 'CONSULTANT' group by c.team_id) r on r.team_id = s.id
     where s.division in ('SALES', 'SUPPORT') and (v_accounts is null or s.department_id <> v_accounts)), '[]'::jsonb);

  -- 5. Technical Consultant -> Department Head (client panel and login ready)
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'consultant-to-head:' || k.id, 'process', 'onboarding',
             'from', jsonb_build_object('kind', 'consultants', 'id', k.id), 'to', jsonb_build_object('kind', 'head', 'id', k.department_id),
             'label', 'Hand over to Department Head', 'hint', 'Every item is authorized and the client login exists',
             'count', coalesce(r.n, 0), 'countLabel', 'with the Department Head') order by k.name)
      from public.teams k
      left join (select c.department_id, count(*) n from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                  where o.handover_stage = 'DEPARTMENT_HEAD' group by c.department_id) r on r.department_id = k.department_id
     where k.division = 'SUPPORT'
       and exists (select 1 from public.profiles p where p.team_id = k.id and p.status = 'ACTIVE' and p.is_technical_consultant)), '[]'::jsonb);

  -- 6. Department Head -> Team Lead (customers passed on, by the team the lead is in); the lead then assigns a member
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'head-to-lead:' || x.team_id, 'process', 'onboarding',
             'from', jsonb_build_object('kind', 'head', 'id', x.department_id), 'to', jsonb_build_object('kind', 'team', 'id', x.team_id),
             'label', 'Pass to Team Lead', 'hint', 'The Team Lead assigns the customer to a Team Member',
             'count', x.n, 'countLabel', 'passed to the Team Lead', 'extra', jsonb_build_object('assignedToMember', x.assigned)) order by x.team_id)
      from (select p.department_id, p.team_id, count(*) n, count(*) filter (where o.team_member_id is not null) assigned
              from public.customer_onboarding o join public.profiles p on p.id = o.team_lead_id
             where p.team_id is not null group by p.department_id, p.team_id) x), '[]'::jsonb);

  -- 7. Delivery: services that skip the consultant go to their own department
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'delivery:' || s.id || ':' || x.dept, 'process', 'delivery',
             'from', jsonb_build_object('kind', 'team', 'id', s.id), 'to', jsonb_build_object('kind', 'department', 'id', x.dept),
             'label', 'Send to delivery department', 'hint', 'Services that need no consultant are delivered by their own department',
             'count', coalesce(r.n, 0), 'countLabel', 'sent', 'extra', jsonb_build_object('services', x.services)) order by s.name)
      from (select delivery_department_id dept, count(*) services from public.crm_services where delivery_department_id is not null group by 1) x
      join public.teams s on s.division in ('SALES', 'SUPPORT') and s.department_id <> x.dept and (v_accounts is null or s.department_id <> v_accounts)
      left join (select c.team_id, cs.delivery_department_id dept, count(*) n
                   from public.customer_services cs join public.customers c on c.id = cs.customer_id
                  where cs.sent_to_delivery_at is not null group by 1, 2) r on r.team_id = s.id and r.dept = x.dept), '[]'::jsonb);

  -- 8. Support ticket escalation: team -> Department Head
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'escalation:' || t.id, 'process', 'tickets',
             'from', jsonb_build_object('kind', 'team', 'id', t.id), 'to', jsonb_build_object('kind', 'head', 'id', t.department_id),
             'label', 'Ticket escalation', 'hint', 'A ticket moves from the member to the Team Lead, then to the Department Head',
             'count', coalesce(r.dh, 0), 'countLabel', 'open at the Department Head', 'extra', jsonb_build_object('atTeamLead', coalesce(r.tl, 0), 'open', coalesce(r.n, 0))) order by t.name)
      from public.teams t
      left join (select department_id,
                        count(*) n,
                        count(*) filter (where escalation_level = 'TL') tl,
                        count(*) filter (where escalation_level = 'DH') dh
                   from public.support_tickets where status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED') group by department_id) r
             on r.department_id = t.department_id
     where t.division = 'SUPPORT'), '[]'::jsonb);

  -- 9. Work tasks: Department Head -> Team Lead
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'tasks:' || x.team_id, 'process', 'tasks',
             'from', jsonb_build_object('kind', 'head', 'id', x.department_id), 'to', jsonb_build_object('kind', 'team', 'id', x.team_id),
             'label', 'Assign task to Team Lead', 'hint', 'The lead splits it between members; updates come back up',
             'count', x.open_n, 'countLabel', 'open', 'extra', jsonb_build_object('total', x.n, 'completed', x.done)) order by x.team_id)
      from (select w.department_id, p.team_id, count(*) n,
                   count(*) filter (where w.status not in ('COMPLETED', 'NOT_COMPLETED')) open_n,
                   count(*) filter (where w.status = 'COMPLETED') done
              from public.work_tasks w join public.profiles p on p.id = w.assignee_id
             where w.parent_id is null and p.team_id is not null and p.role = 'TEAM_HEAD' group by w.department_id, p.team_id) x), '[]'::jsonb);

  -- 10. Leave: Department Head -> HR
  if v_hr is not null then
    v_handoffs := v_handoffs || coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 'leave:' || d.id, 'process', 'leave',
               'from', jsonb_build_object('kind', 'head', 'id', d.id), 'to', jsonb_build_object('kind', 'department', 'id', v_hr),
               'label', 'Leave to HR', 'hint', 'Approved by the Department Head, then decided by HR',
               'count', coalesce(r.hr, 0), 'countLabel', 'waiting for HR', 'extra', jsonb_build_object('waitingForHead', coalesce(r.dh, 0))) order by d.name)
        from public.departments d
        left join (select department_id,
                          count(*) filter (where status = 'PENDING_HR') hr,
                          count(*) filter (where status = 'PENDING_DEPARTMENT_HEAD') dh
                     from public.leave_requests group by department_id) r on r.department_id = d.id
       where d.id <> v_hr), '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'accountsDepartmentId', v_accounts,
    'hrDepartmentId', v_hr,
    'departments', v_departments,
    'teams', v_teams,
    'heads', v_heads,
    'people', v_members,
    'handoffs', v_handoffs);
end $$;

revoke all on function public.company_workflow() from public, anon;
grant execute on function public.company_workflow() to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261113000100_delete_customer.sql
-- =============================================================================
-- Delete a customer (Super Admin, and the Department Head of the customer's department).
--
--   delete_customer(p_customer)   removes the customer and everything that hangs off it that has no value on its own:
--                                 conversations, onboarding, documents (the stored files are returned so the server can
--                                 remove them), tickets, plans, payment requests and payments that were never verified,
--                                 the client login record. It also returns the client's sign-in user id so the server
--                                 can remove that login too.
--   It REFUSES while the customer has an issued invoice or a verified (or reversed) payment: those are the company's
--   financial records, Accounts keeps them, and income reports are built from them.
--   Every deletion is audited (CUSTOMER_DELETED, by the customers table's trigger, with a snapshot of the record).
-- Run after 20261112000300_company_workflow.sql. Safe to run again.
-- =============================================================================

create or replace function public.delete_customer(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_docs jsonb;
  v_client uuid;
begin
  select * into c from public.customers where id = p_customer for update;
  if c.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not (private.is_super_admin()
          or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id is not distinct from private.my_department_id())) then
    raise exception 'FORBIDDEN: Only the Super Admin and the Department Head of the customer''s department can delete a customer.' using errcode = '42501';
  end if;

  if exists (select 1 from public.generated_invoices g where g.customer_id = c.id) then
    raise exception 'CONFLICT: This customer has an issued invoice. Invoices are kept by the Accounts department, so the customer cannot be deleted.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status in ('VERIFIED', 'REVERSED'))
     or exists (select 1 from public.addon_payments p where p.customer_id = c.id and p.status in ('VERIFIED', 'REVERSED'))
     or exists (select 1 from public.invoice_payments p where p.customer_id = c.id) then
    raise exception 'CONFLICT: This customer has a verified payment. Payments are part of the income records kept by Accounts, so the customer cannot be deleted.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', d.storage_bucket, 'path', d.storage_path, 'provider', d.storage_provider)), '[]'::jsonb)
    into v_docs from public.customer_documents d where d.customer_id = c.id and d.storage_path is not null;
  select a.auth_user_id into v_client from public.customer_client_accounts a where a.customer_id = c.id;

  -- what never became money, then the rest (the other tables are removed with the customer)
  delete from public.payment_followups where customer_id = c.id;
  delete from public.customer_payments where customer_id = c.id;
  delete from public.addon_payments where customer_id = c.id;
  delete from public.payment_requests where customer_id = c.id;
  delete from public.customer_documents where customer_id = c.id;
  delete from public.customers where id = c.id;

  -- the customers table's own trigger writes the audit event (CUSTOMER_DELETED, with a snapshot of the record)
  return jsonb_build_object('name', coalesce(nullif(c.company, ''), c.name), 'code', c.customer_code, 'documents', v_docs, 'clientUserId', v_client);
end $$;
revoke all on function public.delete_customer(uuid) from public, anon;
grant execute on function public.delete_customer(uuid) to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261113000200_manual_invoice_pricing.sql
-- =============================================================================
-- Invoice builder: Accounts sets the price of every service. The system no longer divides the budget.
--
-- Until now, with two or more services the builder filled in each amount by splitting what Sales agreed (by the catalogue's
-- starting prices, or equally). With a budget of 12 for two services both lines came pre-filled with 6. Accounts decides how
-- the budget is shared, so now:
--   * one service  -> its line carries the whole balance still to be invoiced (nothing is divided);
--   * two or more  -> every amount is left empty and Accounts enters each price (before GST, a different one per service).
-- The cap is unchanged and still enforced by the database when the invoice is issued: the invoices of the agreed services
-- together can never pass the amount Sales agreed.
-- Only private.spread_invoice_total changes; accounts_invoice_prefill calls it exactly as before. Idempotent.
-- Run after 20261113000100_delete_customer.sql. If 20261102000100 or 20261103000100 is ever run again, run this file again after it:
-- they define the same helper (like the other invoice migrations that replace one another).
-- =============================================================================

create or replace function private.spread_invoice_total(p_lines jsonb, p_total numeric)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  n integer := coalesce(jsonb_array_length(p_lines), 0);
  v_total bigint := floor(coalesce(p_total, 0) * 100);
  v_rate numeric;
  v_base numeric;
begin
  if n = 0 or v_total <= 0 then return p_lines; end if;

  -- several services: no amount is chosen by the system
  if n > 1 then
    return (select jsonb_agg(l || jsonb_build_object('baseAmount', null) order by ord)
              from jsonb_array_elements(p_lines) with ordinality as t(l, ord));
  end if;

  -- one service: the whole balance (with GST at the line's rate, as close as possible without passing it)
  v_rate := coalesce(nullif(p_lines -> 0 ->> 'taxRate', '')::numeric, 18);
  v_base := private.invoice_base_for_total(v_total / 100.0, v_rate);
  if v_base is null or v_base <= 0 then return p_lines; end if;
  return jsonb_build_array((p_lines -> 0) || jsonb_build_object('baseAmount', round(v_base, 2)));
end $$;
revoke all on function private.spread_invoice_total(jsonb, numeric) from public, anon, authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261114000100_revenue_attribution.sql
-- =============================================================================
-- Department-wise income attribution: who acquired the customer, which division (Sales / Support) earns each order, and which
-- department it belongs to - recorded ONCE per order and never rewritten by a later change of owner, team or department.
--
-- Safe to run again. Run it after 20261113000200_manual_invoice_pricing.sql. No money record is changed or duplicated: payments,
-- invoices and orders stay exactly as they are; this adds who-earns-what next to them.
--
-- WHAT WAS WRONG (found by the audit)
--   1. A customer's department mirrors the CURRENT owner (tg_customers_before_write), and every income figure grouped payments by
--      that current department, so reassigning a customer moved all of its past income to another department.
--   2. The first sale was always Sales' (customer_payments are hard-coded to Sales). A customer Support acquired (for example a
--      referral) was credited to Sales. Nothing recorded who acquired a customer.
--   3. Add-ons and monthly plans were always Support's, including those the CLIENT bought from the Client Dashboard. That rule was
--      implicit and unchangeable. It is now an explicit setting, remembered per order.
--   4. Three different calculations of "department income": Accounts' Department Income and the Super Admin dashboard (verified
--      payments by the customer's current department) and the Sales / Support business reports (by division). They are now one.
--
-- THE MODEL
--   customers.acquisition_division / acquisition_department_id / acquired_by
--                       who acquired the customer, written when the customer is created (from the owner's team) and never
--                       changed by a change of owner. NULL = not recorded (customers from before this migration). Corrected only
--                       through set_customer_acquisition() (Accounts / Super Admin, with a reason, audited).
--   revenue_attributions  one row per ORDER (the same order keys the business ledger already uses: SALE:<customer>, ADDON:<request>,
--                       INV:<invoice>, PLAN:<plan>): the division that earns it, the department it belongs to, WHY (source), the
--                       referral source, and a review flag. Written the first time money or an invoice appears for the order.
--   Sources:  ACQUISITION     first sale, division = who acquired the customer
--             DEFAULT_SALES   first sale of a customer whose acquisition was not recorded: Sales (the rule before this migration)
--             SUPPORT_ADDON   add-on sold to an existing customer through Support: Support
--             CLIENT_DASHBOARD an add-on or plan the CLIENT bought in the Client Dashboard: the division chosen by the setting
--                             revenue_attribution_settings.client_purchase_attribution (SUPPORT by default, which is what the system
--                             did silently before; SALES or ACQUISITION are the alternatives). A later change of the setting
--                             affects NEW orders only.
--             SUPPORT_INVOICE an additional invoice Accounts tagged as renewal / add-on: Support
--             LEGACY          an order that existed before this migration, frozen exactly as the old reports counted it
--             MANUAL          corrected by Accounts / Super Admin with a reason (audited)
--   needs_review        LEGACY first sales of customers that a Support member owns or created today: they were counted as Sales
--                       and might belong to Support. They are listed for reconciliation (attribution_reconciliation()), never
--                       moved automatically.
--   Delivery is separate: the department that DELIVERS a service stays crm_services.delivery_department_id /
--   customer_services.delivery_department_id. The responsible employee stays derived from the order's own records.
--
-- Cash basis (unchanged): collected = VERIFIED payments only (gross receipts, GST included). A generated invoice is never money
-- received. Pending payments, reversals (refunds) and the outstanding balance are shown separately; the taxable value and the GST
-- of an order are shown wherever its tax split is known (see order_taxable_ratio()).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who acquired the customer
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists acquisition_division text check (acquisition_division in ('SALES', 'SUPPORT')),
  add column if not exists acquisition_department_id uuid references public.departments (id) on delete set null,
  add column if not exists acquired_by uuid references public.profiles (id) on delete set null;

create or replace function private.tg_customers_acquisition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_div text;
begin
  if tg_op = 'INSERT' then
    -- the owner's team at the moment the customer is created (the team division of the person who works the lead)
    select t.division::text into v_div from public.teams t where t.id = new.team_id;
    new.acquisition_division := case when v_div in ('SALES', 'SUPPORT') then v_div end;
    new.acquisition_department_id := new.department_id;
    new.acquired_by := coalesce(new.created_by, new.owner_id);
  elsif coalesce(current_setting('app.attribution_edit', true), '') <> '1' then
    -- a change of owner, team or department never changes who acquired the customer
    new.acquisition_division := old.acquisition_division;
    -- (the two references may only become empty because the person / department they point to was deleted)
    new.acquisition_department_id := case when new.acquisition_department_id is null and not exists (select 1 from public.departments where id = old.acquisition_department_id)
                                          then null else old.acquisition_department_id end;
    new.acquired_by := case when new.acquired_by is null and not exists (select 1 from public.profiles where id = old.acquired_by)
                            then null else old.acquired_by end;
  end if;
  return new;
end $$;
revoke all on function private.tg_customers_acquisition() from public, anon, authenticated;
-- named so that it fires after customers_before_write (which sets the owner's team and department)
drop trigger if exists customers_before_write_acquisition on public.customers;
create trigger customers_before_write_acquisition before insert or update on public.customers
  for each row execute function private.tg_customers_acquisition();

-- ---------------------------------------------------------------------------
-- 2. The rule for what the client buys in the Client Dashboard (a setting, not code)
-- ---------------------------------------------------------------------------
create table if not exists public.revenue_attribution_settings (
  id boolean primary key default true check (id),
  client_purchase_attribution text not null default 'SUPPORT' check (client_purchase_attribution in ('SUPPORT', 'ACQUISITION', 'SALES')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.revenue_attribution_settings (id) values (true) on conflict (id) do nothing;
alter table public.revenue_attribution_settings enable row level security;
revoke all on public.revenue_attribution_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The attribution of each order (reached only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.revenue_attributions (
  order_key text primary key check (length(order_key) <= 80),
  customer_id uuid not null references public.customers (id) on delete cascade,
  division text not null check (division in ('SALES', 'SUPPORT')),
  department_id uuid references public.departments (id) on delete set null,
  source text not null check (source in ('ACQUISITION', 'DEFAULT_SALES', 'SUPPORT_ADDON', 'CLIENT_DASHBOARD', 'SUPPORT_INVOICE', 'LEGACY', 'MANUAL')),
  acquisition_division text check (acquisition_division in ('SALES', 'SUPPORT')),   -- the customer's acquisition when this was recorded
  referral_source text check (length(referral_source) <= 60),                      -- the customer's lead source when this was recorded
  needs_review boolean not null default false,
  review_note text check (length(review_note) <= 500),
  reason text check (length(reason) <= 500),                                       -- why it was corrected (MANUAL)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create index if not exists revenue_attributions_customer_idx on public.revenue_attributions (customer_id);
create index if not exists revenue_attributions_review_idx on public.revenue_attributions (needs_review) where needs_review;
alter table public.revenue_attributions enable row level security;
revoke all on public.revenue_attributions from public, anon, authenticated;

-- The rule: which division earns this kind of order for this customer, and why.
create or replace function private.attribution_rule(p_customer uuid, p_kind text, out o_division text, out o_source text)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  s public.revenue_attribution_settings;
begin
  select * into c from public.customers where id = p_customer;
  select * into s from public.revenue_attribution_settings where id;
  if p_kind = 'SALE' then
    if c.acquisition_division is not null then o_division := c.acquisition_division; o_source := 'ACQUISITION';
    else o_division := 'SALES'; o_source := 'DEFAULT_SALES'; end if;
  elsif p_kind = 'SUPPORT_ADDON' then
    o_division := 'SUPPORT'; o_source := 'SUPPORT_ADDON';
  elsif p_kind = 'SUPPORT_INVOICE' then
    o_division := 'SUPPORT'; o_source := 'SUPPORT_INVOICE';
  else  -- CLIENT_PURCHASE
    o_division := case s.client_purchase_attribution when 'SALES' then 'SALES' when 'ACQUISITION' then coalesce(c.acquisition_division, 'SALES') else 'SUPPORT' end;
    o_source := 'CLIENT_DASHBOARD';
  end if;
end $$;
revoke all on function private.attribution_rule(uuid, text) from public, anon, authenticated;

-- Records the attribution of an order the first time it is needed. Never changes an existing one.
create or replace function private.ensure_attribution(p_key text, p_customer uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  c public.customers;
begin
  if p_customer is null or exists (select 1 from public.revenue_attributions where order_key = p_key) then
    return;
  end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then return; end if;
  select * into r from private.attribution_rule(p_customer, p_kind);
  insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source)
  values (p_key, p_customer, r.o_division, c.department_id, r.o_source, c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''))
  on conflict (order_key) do nothing;
end $$;
revoke all on function private.ensure_attribution(text, uuid, text) from public, anon, authenticated;

-- ---- the moments an order appears
create or replace function private.tg_attr_sale()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_attribution('SALE:' || new.customer_id::text, new.customer_id, 'SALE');
  return null;
end $$;
revoke all on function private.tg_attr_sale() from public, anon, authenticated;
drop trigger if exists customer_payments_attribution on public.customer_payments;
create trigger customer_payments_attribution after insert on public.customer_payments for each row execute function private.tg_attr_sale();
drop trigger if exists payment_requests_attribution on public.payment_requests;
create trigger payment_requests_attribution after insert on public.payment_requests for each row execute function private.tg_attr_sale();

create or replace function private.tg_attr_addon_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_attribution('ADDON:' || new.id::text, new.customer_id, 'SUPPORT_ADDON');
  return null;
end $$;
revoke all on function private.tg_attr_addon_request() from public, anon, authenticated;
drop trigger if exists addon_requests_attribution on public.addon_requests;
create trigger addon_requests_attribution after insert on public.addon_requests for each row execute function private.tg_attr_addon_request();

create or replace function private.tg_attr_addon_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_attribution('ADDON:' || new.request_id::text, new.customer_id, 'SUPPORT_ADDON');
  return null;
end $$;
revoke all on function private.tg_attr_addon_payment() from public, anon, authenticated;
drop trigger if exists addon_payments_attribution on public.addon_payments;
create trigger addon_payments_attribution after insert on public.addon_payments for each row execute function private.tg_attr_addon_payment();

-- The consultant putting a service the CLIENT requested into an add-on makes it a Client Dashboard purchase (decided once,
-- while nothing has been paid for it and nobody corrected it).
create or replace function private.tg_attr_client_addon()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if new.addon_request_id is null or new.addon_request_id is not distinct from old.addon_request_id then
    return null;
  end if;
  select * into r from private.attribution_rule(new.customer_id, 'CLIENT_PURCHASE');
  update public.revenue_attributions
     set division = r.o_division, source = 'CLIENT_DASHBOARD', updated_at = now()
   where order_key = 'ADDON:' || new.addon_request_id::text and source = 'SUPPORT_ADDON'
     and not exists (select 1 from public.addon_payments p where p.request_id = new.addon_request_id)
     and not exists (select 1 from public.generated_invoices g where g.addon_request_id = new.addon_request_id and exists
                       (select 1 from public.invoice_payments ip where ip.invoice_id = g.invoice_id));
  return null;
end $$;
revoke all on function private.tg_attr_client_addon() from public, anon, authenticated;
drop trigger if exists service_requests_attribution on public.service_requests;
create trigger service_requests_attribution after update of addon_request_id on public.service_requests for each row execute function private.tg_attr_client_addon();

create or replace function private.tg_attr_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_attribution('PLAN:' || new.id::text, new.customer_id, 'CLIENT_PURCHASE');
  return null;
end $$;
revoke all on function private.tg_attr_plan() from public, anon, authenticated;
drop trigger if exists customer_plans_attribution on public.customer_plans;
create trigger customer_plans_attribution after insert on public.customer_plans for each row execute function private.tg_attr_plan();

create or replace function private.tg_attr_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- a services invoice whose payments are recorded on the invoice is an initial-sale order of its own
  if new.purpose = 'SERVICES' and new.payment_ledger = 'INVOICE' then
    perform private.ensure_attribution('INV:' || new.invoice_id::text, new.customer_id, 'SALE');
  end if;
  return null;
end $$;
revoke all on function private.tg_attr_invoice() from public, anon, authenticated;
drop trigger if exists generated_invoices_attribution on public.generated_invoices;
create trigger generated_invoices_attribution after insert on public.generated_invoices for each row execute function private.tg_attr_invoice();

create or replace function private.tg_attr_invoice_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  g public.generated_invoices;
begin
  select * into g from public.generated_invoices where invoice_id = new.invoice_id;
  if g.invoice_id is null then return null; end if;
  if g.purpose = 'SERVICES' then
    perform private.ensure_attribution('INV:' || g.invoice_id::text, g.customer_id, 'SALE');
  elsif g.purpose = 'ADDON' then
    perform private.ensure_attribution('INV:' || g.invoice_id::text, g.customer_id, 'SUPPORT_ADDON');
  elsif exists (select 1 from public.invoice_business_tags t where t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')) then
    perform private.ensure_attribution('INV:' || g.invoice_id::text, g.customer_id, 'SUPPORT_INVOICE');
  end if;
  return null;
end $$;
revoke all on function private.tg_attr_invoice_payment() from public, anon, authenticated;
drop trigger if exists invoice_payments_attribution on public.invoice_payments;
create trigger invoice_payments_attribution after insert on public.invoice_payments for each row execute function private.tg_attr_invoice_payment();

create or replace function private.tg_attr_invoice_tag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
begin
  if new.kind in ('RENEWAL', 'ADDON') then
    select customer_id into v_customer from public.generated_invoices where invoice_id = new.invoice_id;
    perform private.ensure_attribution('INV:' || new.invoice_id::text, v_customer, 'SUPPORT_INVOICE');
  end if;
  return null;
end $$;
revoke all on function private.tg_attr_invoice_tag() from public, anon, authenticated;
drop trigger if exists invoice_business_tags_attribution on public.invoice_business_tags;
create trigger invoice_business_tags_attribution after insert or update of kind on public.invoice_business_tags for each row execute function private.tg_attr_invoice_tag();

-- ---------------------------------------------------------------------------
-- 4. Orders that already exist: frozen EXACTLY as the old reports counted them (nothing is moved or guessed).
--    A first sale of a customer that a Support member owns or created today may have been Support's: flagged for review.
-- ---------------------------------------------------------------------------
insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source, needs_review, review_note)
select k.order_key, k.customer_id, k.division, k.department_id, 'LEGACY', c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''),
       k.division = 'SALES' and (k.order_key like 'SALE:%' or k.order_key like 'INV:%') and exists (
         select 1 from public.profiles p join public.teams t on t.id = p.team_id
          where p.id in (c.owner_id, c.created_by) and t.division = 'SUPPORT'),
       case when k.division = 'SALES' and (k.order_key like 'SALE:%' or k.order_key like 'INV:%') and exists (
              select 1 from public.profiles p join public.teams t on t.id = p.team_id where p.id in (c.owner_id, c.created_by) and t.division = 'SUPPORT')
            then 'Counted as Sales (the rule before attribution was recorded), but a Support team member owns or created this customer. Confirm whether Support acquired it.' end
  from (select distinct on (x.order_key) x.order_key, x.customer_id, x.division, x.department_id
          from (select o.order_key, o.customer_id, o.division, o.department_id from private.business_orders() o
                union all
                select l.order_key, l.customer_id, l.division, l.department_id from private.business_ledger() l where l.division is not null) x
         order by x.order_key) k
  join public.customers c on c.id = k.customer_id
on conflict (order_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. One definition of department income, read from the recorded attribution
-- ---------------------------------------------------------------------------
-- Verified payments with the department they were attributed to (the order's recorded department, not the customer's CURRENT one).
-- The same rows and amounts as private.verified_income() (which stays exactly as it was); only department_id is added.
-- Plan activations are not payments and are not here (as before).
create or replace function private.verified_income_attributed()
returns table (id uuid, customer_id uuid, amount numeric, paid_at timestamptz, payment_type text, method text, reference text,
               verified_by uuid, recorded_at timestamptz, department_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, p.customer_id, p.amount, p.paid_at, p.payment_type, p.method, p.reference, p.verified_by, p.recorded_at,
         coalesce(a.department_id, c.department_id)
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.revenue_attributions a on a.order_key = 'SALE:' || p.customer_id::text
   where p.status = 'VERIFIED'
  union all
  select ap.id, ap.customer_id, ap.amount, ap.paid_at, 'ADDON', ap.method, ap.reference, ap.verified_by, ap.recorded_at,
         coalesce(a.department_id, c.department_id)
    from public.addon_payments ap
    join public.customers c on c.id = ap.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || ap.request_id::text
   where ap.status = 'VERIFIED'
  union all
  select ip.id, ip.customer_id, ip.amount, (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz, ip.payment_type, ip.method, ip.reference,
         ip.recorded_by, ip.recorded_at, coalesce(a.department_id, c.department_id)
    from public.invoice_payments ip
    join public.customers c on c.id = ip.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || ip.invoice_id::text
   where ip.status = 'VERIFIED'
$$;
revoke all on function private.verified_income_attributed() from public, anon, authenticated;

-- The ledger: one row per payment event, classified once. Same columns as before; division and department now come from the
-- order's recorded attribution (the old rule only where nothing was recorded).
create or replace function private.business_ledger()
returns table (tx_key text, source text, source_id uuid, customer_id uuid, department_id uuid, division text, tx_type text,
               amount numeric, status text, occurred_at timestamptz, employee_id uuid, service text, reference text, method text,
               order_key text)
language sql stable security definer set search_path = '' as $$
  -- initial sale: the payments of the agreed services
  select 'CP:' || p.id::text, 'CUSTOMER_PAYMENT', p.id, p.customer_id, coalesce(a.department_id, c.department_id), coalesce(a.division, 'SALES'), 'INITIAL_SALE'::text, p.amount,
         case p.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' when 'REVERSED' then 'REFUNDED' else 'REJECTED' end,
         p.paid_at,
         coalesce(pr.requested_by, case when p.source = 'SALES' then p.recorded_by end, fr.requested_by),
         null::text, p.reference, p.method, 'SALE:' || p.customer_id::text
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.revenue_attributions a on a.order_key = 'SALE:' || p.customer_id::text
    left join public.payment_requests pr on pr.id = p.request_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = p.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- add-on purchases
  select 'AP:' || ap.id::text, 'ADDON_PAYMENT', ap.id, ap.customer_id, coalesce(a.department_id, c.department_id), coalesce(a.division, 'SUPPORT'), 'ADDON', ap.amount,
         case ap.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' else 'REJECTED' end,
         ap.paid_at, coalesce(r.submitted_by, r.created_by, r.consultant_id),
         (select string_agg(i.name, ', ' order by i.sort_order) from public.addon_request_items i where i.request_id = r.id),
         ap.reference, ap.method, 'ADDON:' || r.id::text
    from public.addon_payments ap
    join public.addon_requests r on r.id = ap.request_id
    join public.customers c on c.id = ap.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || r.id::text
  union all
  -- payments recorded on the invoice itself
  select 'IP:' || ip.id::text, 'INVOICE_PAYMENT', ip.id, ip.customer_id, coalesce(a.department_id, c.department_id),
         case when g.purpose = 'SERVICES' then coalesce(a.division, 'SALES') when g.purpose = 'ADDON' or t.kind in ('ADDON', 'RENEWAL') then coalesce(a.division, 'SUPPORT') end,
         case when g.purpose = 'SERVICES' then 'INITIAL_SALE' when g.purpose = 'ADDON' or t.kind = 'ADDON' then 'ADDON'
              when t.kind = 'RENEWAL' then 'RENEWAL' else 'UNCLASSIFIED' end,
         ip.amount, case ip.status when 'VERIFIED' then 'COLLECTED' else 'REFUNDED' end,
         (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz,
         case when g.purpose = 'SERVICES' then fr.requested_by when g.purpose = 'ADDITIONAL' then t.responsible_id end,
         (select s.name from public.crm_services s where s.code = t.service_code), ip.reference, ip.method, 'INV:' || ip.invoice_id::text
    from public.invoice_payments ip
    join public.generated_invoices g on g.invoice_id = ip.invoice_id
    join public.customers c on c.id = ip.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || ip.invoice_id::text
    left join public.invoice_business_tags t on t.invoice_id = ip.invoice_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = ip.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- a monthly plan Accounts activated as paid
  select 'PL:' || cp.id::text, 'PLAN_ACTIVATION', cp.id, cp.customer_id, coalesce(a.department_id, c.department_id), coalesce(a.division, 'SUPPORT'), 'SUBSCRIPTION', cp.price_at_start,
         'COLLECTED', cp.started_at::timestamp at time zone 'Asia/Kolkata', null::uuid,
         (select p.name from public.monthly_plans p where p.id = cp.plan_id), null::text, null::text, 'PLAN:' || cp.id::text
    from public.customer_plans cp
    join public.customers c on c.id = cp.customer_id
    left join public.revenue_attributions a on a.order_key = 'PLAN:' || cp.id::text
   where cp.payment_status = 'PAID' and cp.price_at_start > 0
$$;
revoke all on function private.business_ledger() from public, anon, authenticated;

-- The orders: what was agreed / invoiced (for billed and outstanding). Same columns as before.
create or replace function private.business_orders()
returns table (order_key text, division text, order_type text, customer_id uuid, department_id uuid, employee_id uuid,
               billed numeric, billed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- the services agreed with the customer
  select 'SALE:' || c.id::text, coalesce(a.division, 'SALES'), 'INITIAL_SALE'::text, c.id, coalesce(a.department_id, c.department_id), fr.requested_by, c.deal_amount,
         coalesce(fr.resolved_at, fr.requested_at, (select min(p.recorded_at) from public.customer_payments p where p.customer_id = c.id), c.created_at)
    from public.customers c
    left join public.revenue_attributions a on a.order_key = 'SALE:' || c.id::text
    left join lateral (select x.requested_by, x.resolved_at, x.requested_at from public.payment_requests x
                        where x.customer_id = c.id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where coalesce(c.deal_amount, 0) > 0
     and (fr.requested_by is not null or exists (select 1 from public.payment_requests x where x.customer_id = c.id and x.status <> 'RETURNED')
          or exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status <> 'REJECTED'))
  union all
  -- a services invoice whose payments are recorded on the invoice (the customer has no agreed amount)
  select 'INV:' || g.invoice_id::text, coalesce(a.division, 'SALES'), 'INITIAL_SALE', g.customer_id, coalesce(a.department_id, c.department_id), fr.requested_by, g.total_amount,
         g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.customers c on c.id = g.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || g.invoice_id::text
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = g.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where g.purpose = 'SERVICES' and g.payment_ledger = 'INVOICE'
  union all
  -- approved add-ons that were invoiced
  select 'ADDON:' || r.id::text, coalesce(a.division, 'SUPPORT'), 'ADDON', r.customer_id, coalesce(a.department_id, c.department_id), coalesce(r.submitted_by, r.created_by, r.consultant_id), r.total,
         coalesce((select g.invoice_date::timestamp at time zone 'Asia/Kolkata' from public.generated_invoices g where g.addon_request_id = r.id limit 1),
                  r.decided_at, r.submitted_at, r.created_at)
    from public.addon_requests r
    join public.customers c on c.id = r.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || r.id::text
   where r.status in ('INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') and r.total > 0
  union all
  -- additional invoices Accounts tagged as renewal / add-on
  select 'INV:' || g.invoice_id::text, coalesce(a.division, 'SUPPORT'), case t.kind when 'RENEWAL' then 'RENEWAL' else 'ADDON' end, g.customer_id, coalesce(a.department_id, c.department_id),
         t.responsible_id, g.total_amount, g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.invoice_business_tags t on t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')
    join public.customers c on c.id = g.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || g.invoice_id::text
   where g.purpose = 'ADDITIONAL'
$$;
revoke all on function private.business_orders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Every department-income figure now groups payments by the department they were ATTRIBUTED to (verified_income_attributed().department_id)
--    instead of the customer's current department. The four functions below are the existing ones with only that change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounts_income_list(p_search text DEFAULT NULL::text, p_department uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_sum numeric; v_items jsonb;
begin
  perform private.require_accounts_staff();
  select count(*), coalesce(sum(p.amount), 0) into v_total, v_sum
    from private.verified_income_attributed() p join public.customers c on c.id = p.customer_id
   where (p_department is null or p.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to)
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%'
          or lower(coalesce(p.reference, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(j order by paid_at desc), '[]'::jsonb) into v_items from (
    select p.paid_at, jsonb_build_object(
      'id', p.id, 'paidAt', p.paid_at, 'amount', p.amount, 'type', p.payment_type, 'method', p.method, 'reference', p.reference,
      'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name), 'contact', c.name,
      'departmentId', p.department_id, 'department', d.name,
      'verifiedBy', (select full_name from public.profiles where id = p.verified_by)) as j
      from private.verified_income_attributed() p join public.customers c on c.id = p.customer_id
      left join public.departments d on d.id = p.department_id
     where (p_department is null or p.department_id = p_department)
       and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%'
            or lower(coalesce(p.reference, '')) like '%' || v_term || '%')
     order by p.paid_at desc, p.recorded_at desc
     limit v_size offset (v_page - 1) * v_size) page;
  return jsonb_build_object('items', v_items, 'total', v_total, 'sum', v_sum, 'page', v_page, 'pageSize', v_size);
end $fn$;

CREATE OR REPLACE FUNCTION public.accounts_finance_summary(p_department uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_income numeric; v_income_n bigint;
  v_exp numeric; v_exp_paid numeric; v_exp_pending numeric; v_exp_n bigint;
begin
  perform private.require_accounts_staff();
  select coalesce(sum(p.amount), 0), count(*) into v_income, v_income_n
    from private.verified_income_attributed() p join public.customers c on c.id = p.customer_id
   where (p_department is null or p.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to);
  select coalesce(sum(e.amount), 0), coalesce(sum(e.amount) filter (where e.payment_status = 'PAID'), 0),
         coalesce(sum(e.amount) filter (where e.payment_status = 'PENDING'), 0), count(*)
    into v_exp, v_exp_paid, v_exp_pending, v_exp_n
    from public.department_expenses e
   where (p_department is null or e.department_id = p_department)
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to);
  return jsonb_build_object('income', v_income, 'incomeCount', v_income_n, 'expenses', v_exp, 'expensesPaid', v_exp_paid,
    'expensesPending', v_exp_pending, 'expenseCount', v_exp_n, 'net', v_income - v_exp);
end $fn$;

CREATE OR REPLACE FUNCTION public.accounts_finance_by_department()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v jsonb;
begin
  perform private.require_accounts_staff();
  select coalesce(jsonb_agg(jsonb_build_object(
           'departmentId', d.id, 'name', d.name, 'slug', d.slug,
           'income', coalesce(i.amount, 0), 'incomeCount', coalesce(i.n, 0),
           'expenses', coalesce(x.amount, 0), 'expenseCount', coalesce(x.n, 0),
           'expensesPending', coalesce(x.pending, 0))
         order by d.name), '[]'::jsonb)
    into v
    from public.departments d
    left join (select p.department_id, sum(p.amount) amount, count(*) n
                 from private.verified_income_attributed() p
                group by p.department_id) i on i.department_id = d.id
    left join (select e.department_id, sum(e.amount) amount, count(*) n,
                      sum(e.amount) filter (where e.payment_status = 'PENDING') pending
                 from public.department_expenses e
                where e.department_id is not null
                group by e.department_id) x on x.department_id = d.id
   where d.generates_revenue;
  return v;
end $fn$;

CREATE OR REPLACE FUNCTION public.dashboard_company_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
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
    into v_money from private.verified_income_attributed() p;

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
    left join (select p.department_id, sum(p.amount) amount, sum(p.amount) filter (where p.paid_at::date >= v_month) this_month
                 from private.verified_income_attributed() p group by p.department_id) i on i.department_id = d.id
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
end $fn$;


-- ---------------------------------------------------------------------------
-- 7. The tax split of an order (taxable value and GST), wherever it is known
-- ---------------------------------------------------------------------------
-- The share of an order's gross value that is the taxable service value (1 - GST share), or NULL when the order's tax split is not
-- recorded (an agreement that includes GST and has no invoice yet, a monthly plan). Never guessed: a NULL stays "unknown" in the reports.
--   first sale            an agreement that EXCLUDES GST: agreed amount / total payable; otherwise the invoices issued for it
--   add-on                its invoice (taxable / total), else the add-on request (total without tax / total)
--   invoice order         the invoice's own taxable subtotal / total
create or replace function private.order_taxable_ratio(p_order_key text)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
  v numeric;
  c public.customers;
begin
  if p_order_key like 'SALE:%' then
    v_id := substr(p_order_key, 6)::uuid;
    select * into c from public.customers where id = v_id;
    if c.id is null then return null; end if;
    if c.agreed_tax_basis = 'EXCLUSIVE' and coalesce(c.agreed_amount, 0) > 0 and coalesce(c.deal_amount, 0) > 0 then
      return least(1, round(c.agreed_amount / c.deal_amount, 10));
    end if;
    select sum(g.subtotal) / nullif(sum(g.total_amount), 0) into v from public.generated_invoices g where g.customer_id = v_id and g.payment_ledger = 'CUSTOMER';
  elsif p_order_key like 'ADDON:%' then
    v_id := substr(p_order_key, 7)::uuid;
    select sum(g.subtotal) / nullif(sum(g.total_amount), 0) into v from public.generated_invoices g where g.addon_request_id = v_id;
    if v is null then
      select (r.total - r.tax_total) / nullif(r.total, 0) into v from public.addon_requests r where r.id = v_id;
    end if;
  elsif p_order_key like 'INV:%' then
    v_id := substr(p_order_key, 5)::uuid;
    select g.subtotal / nullif(g.total_amount, 0) into v from public.generated_invoices g where g.invoice_id = v_id;
  end if;
  return case when v is null then null else least(1, greatest(0, round(v, 10))) end;
end $$;
revoke all on function private.order_taxable_ratio(text) from public, anon, authenticated;

create or replace function private.income_json(
  p_collected numeric, p_col_taxable numeric, p_col_known numeric, p_pending numeric, p_refunded numeric, p_payments numeric,
  p_billed numeric, p_bill_taxable numeric, p_bill_known numeric, p_outstanding numeric, p_orders numeric)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'collected', coalesce(p_collected, 0),
    'collectedTaxable', coalesce(p_col_taxable, 0),
    'collectedGst', coalesce(p_col_known, 0) - coalesce(p_col_taxable, 0),
    'collectedTaxSplitUnknown', coalesce(p_collected, 0) - coalesce(p_col_known, 0),
    'pending', coalesce(p_pending, 0),
    'refunded', coalesce(p_refunded, 0),
    'payments', coalesce(p_payments, 0),
    'billed', coalesce(p_billed, 0),
    'billedTaxable', coalesce(p_bill_taxable, 0),
    'billedGst', coalesce(p_bill_known, 0) - coalesce(p_bill_taxable, 0),
    'billedTaxSplitUnknown', coalesce(p_billed, 0) - coalesce(p_bill_known, 0),
    'outstanding', coalesce(p_outstanding, 0),
    'orders', coalesce(p_orders, 0))
$$;
revoke all on function private.income_json(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Who may read the department income: Super Admin and Accounts (every department), a Department Head (their own)
-- ---------------------------------------------------------------------------
create or replace function private.income_scope(p_department uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if private.is_super_admin() or private.is_accounts_staff() then
    return p_department;
  end if;
  if private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() is not null then
    if p_department is not null and p_department <> private.my_department_id() then
      raise exception 'FORBIDDEN: A Department Head can see only their own department''s income.' using errcode = '42501';
    end if;
    return private.my_department_id();
  end if;
  raise exception 'FORBIDDEN: Only the Super Admin, Accounts and Department Heads can see department income.' using errcode = '42501';
end $$;
revoke all on function private.income_scope(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. The department income report
-- ---------------------------------------------------------------------------
-- collected   verified payments in the range (gross receipts, GST included), each payment counted once, in the order's division
--             and department. A generated invoice is never collected until a payment on it is verified.
-- pending     payments recorded but not yet verified.   refunded  payments that were reversed (not in collected).
-- billed      the value of the orders (what was agreed / invoiced), GST included.   outstanding  billed - collected per order, never below zero.
-- ...Taxable / ...Gst  the split of the same figures where the order's tax split is known; ...TaxSplitUnknown is the rest.
create or replace function public.department_income_report(p_department uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid := private.income_scope(p_department);
  v jsonb;
begin
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_scope is not null and not exists (select 1 from public.departments where id = v_scope) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;

  with l0 as materialized (
    select x.* from private.business_ledger() x
     where x.status <> 'REJECTED' and (v_scope is null or x.department_id = v_scope)
       and (p_from is null or x.occurred_at >= private.business_day_start(p_from))
       and (p_to is null or x.occurred_at < private.business_day_start(p_to + 1))),
  life as materialized (
    select z.order_key,
           coalesce(sum(z.amount) filter (where z.status = 'COLLECTED'), 0) collected, coalesce(sum(z.amount) filter (where z.status = 'PENDING'), 0) pending,
           coalesce(sum(z.amount) filter (where z.status = 'REFUNDED'), 0) refunded, count(*) filter (where z.status = 'COLLECTED') n_paid,
           max(z.occurred_at) filter (where z.status = 'COLLECTED') last_paid
      from private.business_ledger() z group by z.order_key),
  o0 as materialized (
    select o.* from private.business_orders() o
     where (v_scope is null or o.department_id = v_scope)
       and ((p_from is null and p_to is null)
            or ((p_from is null or o.billed_at >= private.business_day_start(p_from)) and (p_to is null or o.billed_at < private.business_day_start(p_to + 1)))
            or exists (select 1 from l0 where l0.order_key = o.order_key))),
  rt as materialized (
    select k.order_key, private.order_taxable_ratio(k.order_key) ratio
      from (select order_key from l0 union select order_key from o0) k),
  l as materialized (
    select x.*, a.source attr_source, a.acquisition_division, a.referral_source, r.ratio
      from l0 x left join public.revenue_attributions a on a.order_key = x.order_key left join rt r on r.order_key = x.order_key
     where x.division is not null),
  o as materialized (
    select x.*, a.source attr_source, a.needs_review, a.review_note, a.acquisition_division, a.referral_source, r.ratio,
           coalesce(f.collected, 0) collected, coalesce(f.pending, 0) pending, coalesce(f.refunded, 0) refunded, coalesce(f.n_paid, 0) n_paid, f.last_paid
      from o0 x left join public.revenue_attributions a on a.order_key = x.order_key left join rt r on r.order_key = x.order_key left join life f on f.order_key = x.order_key),
  la as (
    select department_id, division, coalesce(attr_source, 'UNRECORDED') source, tx_type, coalesce(service, '') service, acquisition_division, referral_source,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected,
           coalesce(sum(round(amount * ratio, 2)) filter (where status = 'COLLECTED' and ratio is not null), 0) col_taxable,
           coalesce(sum(amount) filter (where status = 'COLLECTED' and ratio is not null), 0) col_known,
           coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending, coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded,
           count(*) filter (where status = 'COLLECTED') n
      from l group by 1, 2, 3, 4, 5, 6, 7),
  oa as (
    select department_id, division, coalesce(attr_source, 'UNRECORDED') source, order_type tx_type, acquisition_division, referral_source,
           count(*) orders, coalesce(sum(billed), 0) billed, coalesce(sum(round(billed * ratio, 2)) filter (where ratio is not null), 0) bill_taxable,
           coalesce(sum(billed) filter (where ratio is not null), 0) bill_known, coalesce(sum(greatest(billed - collected, 0)), 0) outstanding
      from o group by 1, 2, 3, 4, 5, 6)
  select jsonb_build_object(
    'scope', jsonb_build_object('departmentId', v_scope, 'name', (select name from public.departments where id = v_scope), 'from', p_from, 'to', p_to),
    'basis', 'Cash basis. Collected = verified payments (gross receipts, GST included), each counted once. A generated invoice is not money received. Pending, refunded and outstanding are separate.',
    'rule', (select client_purchase_attribution from public.revenue_attribution_settings where id),
    'totals', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
                 from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la) l1,
                      (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa) o1),
    'byDivision', coalesce((select jsonb_object_agg(lower(d.division), private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n))
                 from (values ('SALES'), ('SUPPORT')) d(division)
                 cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.division = d.division) l1
                 cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.division = d.division) o1), '{}'::jsonb),
    'byType', coalesce((select jsonb_agg(jsonb_build_object('division', t.division, 'type', t.tx_type) || private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n) order by t.division, t.tx_type)
                 from (select division, tx_type from la union select division, tx_type from oa) t
                 cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.division = t.division and la.tx_type = t.tx_type) l1
                 cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.division = t.division and oa.tx_type = t.tx_type) o1), '[]'::jsonb),
    'bySource', coalesce((select jsonb_agg(jsonb_build_object('source', s.source) || private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n) order by s.source)
                 from (select source from la union select source from oa) s
                 cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.source = s.source) l1
                 cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.source = s.source) o1), '[]'::jsonb),
    'byService', coalesce((select jsonb_agg(jsonb_build_object('service', sv.service, 'division', sv.division, 'collected', sv.c, 'pending', sv.p, 'refunded', sv.r, 'payments', sv.n) order by sv.c desc, sv.service)
                 from (select coalesce(nullif(service, ''), case tx_type when 'INITIAL_SALE' then 'Initial sale (agreed services)' when 'SUBSCRIPTION' then 'Monthly plan' else 'Other' end) service,
                              division, sum(collected) c, sum(pending) p, sum(refunded) r, sum(n) n
                         from la group by 1, 2) sv), '[]'::jsonb),
    'highlights', jsonb_build_object(
      'supportAddOns', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
          from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where division = 'SUPPORT' and tx_type = 'ADDON') l1,
               (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where division = 'SUPPORT' and tx_type = 'ADDON') o1),
      'supportAcquired', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
          from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where division = 'SUPPORT' and tx_type = 'INITIAL_SALE' and source = 'ACQUISITION') l1,
               (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where division = 'SUPPORT' and tx_type = 'INITIAL_SALE' and source = 'ACQUISITION') o1),
      'supportReferrals', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
          from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la
                 where division = 'SUPPORT' and tx_type = 'INITIAL_SALE' and source = 'ACQUISITION' and lower(coalesce(referral_source, '')) = 'referral') l1,
               (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa
                 where division = 'SUPPORT' and tx_type = 'INITIAL_SALE' and source = 'ACQUISITION' and lower(coalesce(referral_source, '')) = 'referral') o1),
      'clientDashboard', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
          from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where source = 'CLIENT_DASHBOARD') l1,
               (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where source = 'CLIENT_DASHBOARD') o1)),
    'departments', case when v_scope is not null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('departmentId', dd.id, 'name', dd.name,
                 'sales', private.income_json(s1.c, s1.ct, s1.ck, s1.p, s1.r, s1.n, so.b, so.bt, so.bk, so.o, so.n),
                 'support', private.income_json(u1.c, u1.ct, u1.ck, u1.p, u1.r, u1.n, uo.b, uo.bt, uo.bk, uo.o, uo.n),
                 'collected', coalesce(s1.c, 0) + coalesce(u1.c, 0), 'outstanding', coalesce(so.o, 0) + coalesce(uo.o, 0))
                 order by coalesce(s1.c, 0) + coalesce(u1.c, 0) desc, dd.name)
          from public.departments dd
          cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.department_id = dd.id and la.division = 'SALES') s1
          cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.department_id = dd.id and la.division = 'SUPPORT') u1
          cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.department_id = dd.id and oa.division = 'SALES') so
          cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.department_id = dd.id and oa.division = 'SUPPORT') uo
         where s1.c is not null or u1.c is not null or so.o is not null or uo.o is not null or s1.p is not null or u1.p is not null), '[]'::jsonb) end,
    'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'orderKey', t.order_key, 'type', t.order_type, 'division', t.division, 'source', coalesce(t.attr_source, 'UNRECORDED'), 'departmentId', t.department_id,
                 'department', dd.name, 'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name),
                 'services', case when t.order_key like 'SALE:%' then (select string_agg(s.name, ', ' order by s.sort_order) from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = t.customer_id)
                                  when t.order_key like 'ADDON:%' then (select string_agg(i.name, ', ' order by i.sort_order) from public.addon_request_items i where i.request_id = substr(t.order_key, 7)::uuid)
                                  else (select s.name from public.invoice_business_tags tg join public.crm_services s on s.code = tg.service_code where tg.invoice_id = substr(t.order_key, 5)::uuid) end,
                 'billed', coalesce(t.billed, 0), 'taxSplitKnown', t.ratio is not null,
                 'billedTaxable', case when t.ratio is not null then round(coalesce(t.billed, 0) * t.ratio, 2) end,
                 'billedGst', case when t.ratio is not null then coalesce(t.billed, 0) - round(coalesce(t.billed, 0) * t.ratio, 2) end,
                 'collected', t.collected, 'pending', t.pending, 'refunded', t.refunded, 'outstanding', greatest(coalesce(t.billed, 0) - t.collected, 0),
                 'payments', t.n_paid, 'partPaid', t.collected > 0 and coalesce(t.billed, 0) - t.collected > 0,
                 'lastPaymentAt', t.last_paid, 'billedAt', t.billed_at, 'referralSource', t.referral_source, 'acquisitionDivision', t.acquisition_division,
                 'needsReview', coalesce(t.needs_review, false), 'reviewNote', t.review_note)
                 order by coalesce(t.last_paid, t.billed_at) desc nulls last)
          from (select * from o order by coalesce(last_paid, billed_at) desc nulls last limit 200) t
          join public.customers c on c.id = t.customer_id
          left join public.departments dd on dd.id = t.department_id), '[]'::jsonb),
    'review', jsonb_build_object(
      'needsReview', (select count(*) from o where coalesce(needs_review, false)),
      'needsReviewCollected', coalesce((select sum(collected) from o where coalesce(needs_review, false)), 0),
      'unclassifiedInvoices', (select count(*) from l0 where tx_type = 'UNCLASSIFIED'),
      'unrecordedAttribution', (select count(*) from o where attr_source is null))
  ) into v;
  return v;
end $$;
revoke all on function public.department_income_report(uuid, date, date) from public, anon;
grant execute on function public.department_income_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Reconciliation and corrections (Accounts and the Super Admin; every change audited)
-- ---------------------------------------------------------------------------
create or replace function public.attribution_reconciliation()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can reconcile attribution.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'legacyOrders', (select count(*) from public.revenue_attributions where source = 'LEGACY'),
    'withoutAcquisition', (select count(*) from public.customers c where c.acquisition_division is null
                             and exists (select 1 from public.revenue_attributions a where a.customer_id = c.id)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orderKey', a.order_key, 'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name),
               'division', a.division, 'source', a.source, 'departmentId', a.department_id, 'department', d.name, 'note', a.review_note,
               'collected', coalesce((select sum(l.amount) from private.business_ledger() l where l.order_key = a.order_key and l.status = 'COLLECTED'), 0),
               'acquisitionDivision', c.acquisition_division, 'ownerDivision', (select t.division::text from public.profiles p join public.teams t on t.id = p.team_id where p.id = c.owner_id))
             order by c.customer_code)
        from public.revenue_attributions a join public.customers c on c.id = a.customer_id left join public.departments d on d.id = a.department_id
       where a.needs_review), '[]'::jsonb));
end $$;
revoke all on function public.attribution_reconciliation() from public, anon;
grant execute on function public.attribution_reconciliation() to authenticated;

-- Correct who earns one order (and the department it belongs to). Needs a reason. Existing orders are never moved any other way.
create or replace function public.set_order_attribution(p_order_key text, p_division text, p_department uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_customer uuid;
  v_dept uuid;
  old public.revenue_attributions;
  c public.customers;
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can change attribution.' using errcode = '42501';
  end if;
  if p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Say why the attribution is being changed.' using errcode = 'P0001';
  end if;
  select x.customer_id into v_customer from (select order_key, customer_id from private.business_orders() union all select order_key, customer_id from private.business_ledger()) x
   where x.order_key = p_order_key limit 1;
  if v_customer is null then
    raise exception 'NOT_FOUND: Order not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  select * into old from public.revenue_attributions where order_key = p_order_key;
  v_dept := coalesce(p_department, old.department_id, c.department_id);
  if not exists (select 1 from public.departments where id = v_dept and generates_revenue) then
    raise exception 'VALIDATION_ERROR: Choose a department that earns revenue.' using errcode = 'P0001';
  end if;
  insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source, needs_review, reason, updated_by)
  values (p_order_key, v_customer, p_division, v_dept, 'MANUAL', c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''), false, v_reason, auth.uid())
  on conflict (order_key) do update
     set division = excluded.division, department_id = excluded.department_id, source = 'MANUAL', needs_review = false, review_note = null,
         reason = excluded.reason, updated_at = now(), updated_by = excluded.updated_by;
  perform private.write_audit('ORDER_ATTRIBUTION_CHANGED', 'customer', v_customer, c.department_id, c.team_id,
    jsonb_build_object('order', p_order_key, 'from_division', old.division, 'to_division', p_division, 'from_department', old.department_id,
                       'to_department', v_dept, 'from_source', old.source, 'reason', v_reason));
  return jsonb_build_object('orderKey', p_order_key, 'division', p_division, 'departmentId', v_dept, 'source', 'MANUAL');
end $$;
revoke all on function public.set_order_attribution(text, text, uuid, text) from public, anon;
grant execute on function public.set_order_attribution(text, text, uuid, text) to authenticated;

-- Record who acquired a customer (for customers from before this was recorded). Future orders follow it; existing orders are NOT moved
-- (use set_order_attribution for those).
create or replace function public.set_customer_acquisition(p_customer uuid, p_division text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  c public.customers;
  v_old text;
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can change who acquired a customer.' using errcode = '42501';
  end if;
  if p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Say why this is being recorded.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  if c.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  v_old := c.acquisition_division;
  perform set_config('app.attribution_edit', '1', true);
  update public.customers set acquisition_division = p_division, acquisition_department_id = coalesce(acquisition_department_id, department_id) where id = p_customer;
  perform set_config('app.attribution_edit', '', true);
  perform private.write_audit('CUSTOMER_ACQUISITION_CHANGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('from', v_old, 'to', p_division, 'reason', v_reason));
  return jsonb_build_object('customerId', p_customer, 'acquisitionDivision', p_division,
    'ordersToReview', (select count(*) from public.revenue_attributions a where a.customer_id = p_customer and a.source in ('LEGACY', 'DEFAULT_SALES') and a.order_key not like 'ADDON:%' and a.order_key not like 'PLAN:%'));
end $$;
revoke all on function public.set_customer_acquisition(uuid, text, text) from public, anon;
grant execute on function public.set_customer_acquisition(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The rule for Client Dashboard purchases (Super Admin changes it; Accounts may read it)
-- ---------------------------------------------------------------------------
create or replace function public.revenue_attribution_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can see this setting.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('clientPurchaseAttribution', client_purchase_attribution, 'updatedAt', updated_at) from public.revenue_attribution_settings where id);
end $$;
revoke all on function public.revenue_attribution_settings_get() from public, anon;
grant execute on function public.revenue_attribution_settings_get() to authenticated;

create or replace function public.set_revenue_attribution_settings(p_client_purchase text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change this setting.' using errcode = '42501';
  end if;
  if p_client_purchase not in ('SUPPORT', 'ACQUISITION', 'SALES') then
    raise exception 'VALIDATION_ERROR: Choose Support, the acquiring division, or Sales.' using errcode = 'P0001';
  end if;
  select client_purchase_attribution into v_old from public.revenue_attribution_settings where id;
  update public.revenue_attribution_settings set client_purchase_attribution = p_client_purchase, updated_by = auth.uid(), updated_at = now() where id;
  perform private.write_audit('REVENUE_ATTRIBUTION_RULE_CHANGED', 'revenue_attribution_settings', null, null, null,
    jsonb_build_object('client_purchase_from', v_old, 'client_purchase_to', p_client_purchase));
  return jsonb_build_object('clientPurchaseAttribution', p_client_purchase);
end $$;
revoke all on function public.set_revenue_attribution_settings(text) from public, anon;
grant execute on function public.set_revenue_attribution_settings(text) to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261114000200_payment_gst.sql
-- GST when Accounts records a payment.
--
-- Safe to run again. Run it after 20261114000100_revenue_attribution.sql.
--
-- Until now a payment was a single amount: nothing said how much of it was GST. Accounts now types the amount BEFORE GST, chooses the
-- GST rate, and sees the final amount (what the customer actually paid). The final amount is what is recorded as received, so every
-- balance, ledger and report that reads the payment amount is unchanged. The GST is stored with the payment.
--
--   customer_payments.taxable_amount / gst_rate / gst_amount   NULL = no GST was recorded (payments from before this change, and
--                                                              orders whose agreed amount already includes GST).
--                                                              amount = taxable_amount + gst_amount.
--   GST is ON TOP of the agreed amount (Sales agrees an amount before GST; Accounts decides the GST). So the order's total payable is
--     agreed amount + the GST of the order, where the GST of the order is the larger of the GST of the invoices Accounts issued and the
--     GST recorded on payments. (The same money is not taxed twice when its invoice repeats the GST recorded on the payment.)
--   Invoices are not changed: Accounts still chooses the GST on the invoice itself.
--
-- New functions (the old ones stay, for callers that do not send a GST rate):
--   accounts_record_taxed_payment / accounts_update_taxed_payment      the same rules as before, with the GST rate
-- and these are replaced so the order's total payable follows the payments' GST:
--   private.sync_order_payable, private.sync_payment_totals, customer_payment_overview

alter table public.customer_payments
  add column if not exists taxable_amount numeric(14, 2) check (taxable_amount > 0),
  add column if not exists gst_rate numeric(5, 2) check (gst_rate >= 0 and gst_rate <= 28),
  add column if not exists gst_amount numeric(14, 2) check (gst_amount >= 0);
alter table public.customer_payments drop constraint if exists customer_payments_gst_consistent;
alter table public.customer_payments add constraint customer_payments_gst_consistent
  check ((taxable_amount is null and gst_rate is null and gst_amount is null)
         or (taxable_amount is not null and gst_rate is not null and gst_amount is not null and amount = taxable_amount + gst_amount));

-- ---------------------------------------------------------------------------
-- The total payable of an order whose agreement excludes GST: the agreed amount plus the order's GST
-- (the larger of the invoices' GST and the GST recorded on the payments), and never below what was received.
-- ---------------------------------------------------------------------------
create or replace function private.sync_order_payable(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_inv_gst numeric; v_pay_gst numeric; v_new numeric;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or c.agreed_amount is null or c.agreed_tax_basis <> 'EXCLUSIVE' then
    return;
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_gst), 0) into v_net, v_inv_gst
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  select coalesce(sum(gst_amount), 0) into v_pay_gst
    from public.customer_payments where customer_id = c.id and status in ('PENDING', 'VERIFIED');
  -- no GST is assumed for the part that is neither invoiced nor paid yet: Accounts decides it
  v_new := round(v_net + v_inv_gst + greatest(c.agreed_amount - v_net, 0) + greatest(v_pay_gst - v_inv_gst, 0), 2);
  -- never below what has already been received
  v_new := greatest(v_new, c.amount_received);
  if c.deal_amount is distinct from v_new then
    update public.customers set deal_amount = v_new where id = c.id;
  end if;
end $$;
revoke all on function private.sync_order_payable(uuid) from public, anon, authenticated;

-- The payments' totals, now keeping the total payable in step (raised BEFORE the received amount grows, lowered after it shrinks:
-- a customer's received amount may never exceed the total payable).
create or replace function private.sync_payment_totals(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recorded numeric;
  v_verified numeric;
begin
  perform private.sync_order_payable(p_customer);
  select coalesce(sum(amount) filter (where status in ('PENDING', 'VERIFIED')), 0),
         coalesce(sum(amount) filter (where status = 'VERIFIED'), 0)
    into v_recorded, v_verified
    from public.customer_payments where customer_id = p_customer;
  update public.customers set amount_received = v_recorded, amount_verified = v_verified where id = p_customer;
  update public.customer_onboarding set payment_verified = v_verified > 0 where customer_id = p_customer;
  perform private.sync_order_payable(p_customer);
  perform private.sync_invoice_payment_status(p_customer);
end $$;
revoke all on function private.sync_payment_totals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The checks of a payment with GST. p_taxable is the amount before GST. Returns the GST and the final amount.
-- p_rate NULL = the payment records no GST (orders whose agreed amount includes GST, and callers that send no rate).
-- ---------------------------------------------------------------------------
create or replace function private.check_taxed_payment(
  v public.customers, p_exclude uuid, p_type text, p_taxable numeric, p_rate numeric, p_method text, p_reference text, p_paid_at timestamptz,
  out o_gst numeric, out o_final numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_recorded numeric;
  v_other_pay_gst numeric;
  v_net numeric; v_inv_gst numeric;
  v_deal numeric;
  v_exclusive boolean := v.agreed_amount is not null and v.agreed_tax_basis = 'EXCLUSIVE';
begin
  if p_type is null or p_type not in ('PART', 'FULL') then
    raise exception 'VALIDATION_ERROR: Choose part payment or full payment.' using errcode = 'P0001';
  end if;
  if coalesce(p_taxable, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the amount received.' using errcode = 'P0001';
  end if;
  if p_method is null or p_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select the payment method.' using errcode = 'P0001';
  end if;
  if p_method in ('UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE') and p_reference is null then
    raise exception 'VALIDATION_ERROR: Enter the transaction / reference number.' using errcode = 'P0001';
  end if;
  if p_paid_at > now() + interval '1 hour' then
    raise exception 'VALIDATION_ERROR: The payment date cannot be in the future.' using errcode = 'P0001';
  end if;
  if coalesce(v.deal_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: The agreed amount is not set for this customer.' using errcode = 'P0001';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 28 or p_rate <> round(p_rate, 2)) then
    raise exception 'VALIDATION_ERROR: Choose a GST rate between 0 and 28 percent.' using errcode = 'P0001';
  end if;
  if p_rate is not null and not v_exclusive then
    if p_rate > 0 then
      raise exception 'VALIDATION_ERROR: The agreed amount of this order already includes GST, so GST cannot be added on top. Record the amount received.' using errcode = 'P0001';
    end if;
  end if;

  o_gst := case when p_rate is null or not v_exclusive then 0 else round(p_taxable * p_rate / 100, 2) end;
  o_final := p_taxable + o_gst;

  select coalesce(sum(amount), 0), coalesce(sum(gst_amount), 0) into v_recorded, v_other_pay_gst
    from public.customer_payments where customer_id = v.id and status in ('PENDING', 'VERIFIED') and id is distinct from p_exclude;
  -- the total payable as it will be once this payment is recorded
  if v_exclusive then
    select coalesce(sum(subtotal), 0), coalesce(sum(total_gst), 0) into v_net, v_inv_gst
      from public.generated_invoices where customer_id = v.id and payment_ledger = 'CUSTOMER';
    v_deal := round(v_net + v_inv_gst + greatest(v.agreed_amount - v_net, 0) + greatest(v_other_pay_gst + o_gst - v_inv_gst, 0), 2);
  else
    v_deal := v.deal_amount;
  end if;
  -- whole rupees, except the payment that settles the exact balance (GST brings paise)
  if p_taxable <> trunc(p_taxable) and v_recorded + o_final <> v_deal then
    raise exception 'VALIDATION_ERROR: Enter the amount in whole rupees (no paise). Only the payment that settles the exact balance (%) can include paise.', private.rupees(v_deal - v_recorded) using errcode = 'P0001';
  end if;
  if v_recorded + o_final > v_deal then
    raise exception 'VALIDATION_ERROR: This would exceed the agreed amount. Balance still to receive: %.', private.rupees(greatest(v_deal - v_recorded, 0)) using errcode = 'P0001';
  end if;
  if p_type = 'FULL' and v_recorded + o_final <> v_deal then
    raise exception 'VALIDATION_ERROR: A full payment must settle the agreed amount (balance %). Record it as a part payment instead.', private.rupees(v_deal - v_recorded) using errcode = 'P0001';
  end if;
  if p_type = 'PART' and v_recorded + o_final = v_deal then
    raise exception 'VALIDATION_ERROR: This payment settles the agreed amount. Record it as a full payment.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_taxed_payment(public.customers, uuid, text, numeric, numeric, text, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Record / edit a payment with GST (Accounts)
-- ---------------------------------------------------------------------------
create or replace function public.accounts_record_taxed_payment(
  p_customer uuid, p_type text, p_amount numeric, p_method text, p_reference text default null, p_paid_at timestamptz default null,
  p_note text default null, p_verify boolean default false, p_gst_rate numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  v_ref text := left(nullif(btrim(coalesce(p_reference, '')), ''), 120);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_paid timestamptz := coalesce(p_paid_at, now());
  v_request uuid;
  v_id uuid;
  v_status text := case when coalesce(p_verify, false) then 'VERIFIED' else 'PENDING' end;
  r record;
  v_taxed boolean;
begin
  if v.lifecycle_stage not in ('LEAD', 'ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Payments cannot be recorded for this customer right now.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage = 'LEAD' and v.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This lead is not with Accounts.' using errcode = 'P0001';
  end if;
  select * into r from private.check_taxed_payment(v, null, p_type, p_amount, p_gst_rate, p_method, v_ref, v_paid);
  v_taxed := p_gst_rate is not null and v.agreed_amount is not null and v.agreed_tax_basis = 'EXCLUSIVE';
  select id into v_request from public.payment_requests where customer_id = p_customer and status = 'PENDING';

  begin
    insert into public.customer_payments (customer_id, request_id, payment_type, amount, taxable_amount, gst_rate, gst_amount, method, reference, paid_at,
                                          status, source, note, recorded_by, verified_by, verified_at)
    values (p_customer, v_request, p_type, r.o_final, case when v_taxed then p_amount end, case when v_taxed then p_gst_rate end, case when v_taxed then r.o_gst end,
            p_method, v_ref, v_paid, v_status, 'ACCOUNTS', v_note,
            (select private.my_id()), case when v_status = 'VERIFIED' then (select private.my_id()) end, case when v_status = 'VERIFIED' then now() end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'CONFLICT: A payment with this reference is already recorded for this customer.' using errcode = 'P0001';
  end;
  perform private.sync_payment_totals(p_customer);
  update public.customers set accounts_owner_id = coalesce(accounts_owner_id, (select private.my_id())) where id = p_customer;
  perform private.log_customer_activity(p_customer, case when v_status = 'VERIFIED' then 'PAYMENT_VERIFIED' else 'PAYMENT_RECORDED' end,
    format('%s %s of %s%s %s', case p_type when 'PART' then 'Part payment' else 'Full payment' end,
           case when v_status = 'VERIFIED' then 'verified' else 'recorded (pending verification)' end, private.rupees(r.o_final),
           case when v_taxed and r.o_gst > 0 then format(' (%s + GST %s at %s%%)', private.rupees(p_amount), private.rupees(r.o_gst), p_gst_rate::text) else '' end, 'by Accounts'));
  perform private.write_audit(case when v_status = 'VERIFIED' then 'PAYMENT_VERIFIED' else 'PAYMENT_RECORDED' end, 'customer', p_customer,
    v.department_id, v.team_id, jsonb_build_object('payment_id', v_id, 'type', p_type, 'amount', r.o_final, 'taxable', case when v_taxed then p_amount end,
      'gst_rate', case when v_taxed then p_gst_rate end, 'gst', case when v_taxed then r.o_gst end, 'method', p_method, 'reference', v_ref));
  if v_status = 'VERIFIED' then
    perform private.notify(v.owner_id, 'PAYMENT_VERIFIED', format('Payment verified: %s', coalesce(v.company, v.name)),
      format('Accounts verified %s (%s).', private.rupees(r.o_final), case p_type when 'PART' then 'part payment' else 'full payment' end), 'customer', p_customer);
  end if;
  return v_id;
end $$;
revoke all on function public.accounts_record_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, boolean, numeric) from public, anon;
grant execute on function public.accounts_record_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, boolean, numeric) to authenticated;

create or replace function public.accounts_update_taxed_payment(
  p_payment uuid, p_type text, p_amount numeric, p_method text, p_reference text default null, p_paid_at timestamptz default null,
  p_note text default null, p_gst_rate numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  v public.customers;
  v_ref text := left(nullif(btrim(coalesce(p_reference, '')), ''), 120);
  v_paid timestamptz;
  r record;
  v_taxed boolean;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if p.id is null then
    raise exception 'NOT_FOUND: Payment not found.' using errcode = 'P0001';
  end if;
  v := private.lock_customer_for_accounts(p.customer_id);
  if p.status <> 'PENDING' then
    raise exception 'CONFLICT: Only a payment that is still pending can be edited.' using errcode = 'P0001';
  end if;
  v_paid := coalesce(p_paid_at, p.paid_at);
  select * into r from private.check_taxed_payment(v, p.id, p_type, p_amount, p_gst_rate, p_method, v_ref, v_paid);
  v_taxed := p_gst_rate is not null and v.agreed_amount is not null and v.agreed_tax_basis = 'EXCLUSIVE';
  begin
    update public.customer_payments
       set payment_type = p_type, amount = r.o_final, taxable_amount = case when v_taxed then p_amount end,
           gst_rate = case when v_taxed then p_gst_rate end, gst_amount = case when v_taxed then r.o_gst end,
           method = p_method, reference = v_ref, paid_at = v_paid, note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000)
     where id = p.id;
  exception when unique_violation then
    raise exception 'CONFLICT: A payment with this reference is already recorded for this customer.' using errcode = 'P0001';
  end;
  perform private.sync_payment_totals(p.customer_id);
  perform private.write_audit('PAYMENT_EDITED', 'customer', p.customer_id, v.department_id, v.team_id,
    jsonb_build_object('payment_id', p.id, 'amount', r.o_final, 'taxable', case when v_taxed then p_amount end, 'gst', case when v_taxed then r.o_gst end));
end $$;
revoke all on function public.accounts_update_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, numeric) from public, anon;
grant execute on function public.accounts_update_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- The payment overview: each payment's GST split, and what the form needs
--   gst.allowed          the agreed amount excludes GST, so Accounts can add it
--   gst.onPayments       the GST recorded on pending and verified payments
--   gst.taxableBalance   what is left of the agreed amount before GST (a suggestion for a full payment; the database decides)
-- ---------------------------------------------------------------------------
create or replace function public.customer_payment_overview(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.customers;
  v_accounts boolean := private.accounts_can_view(p_customer);
  v_exclusive boolean;
  v_inv_gst numeric;
  v_taxable_paid numeric;
begin
  if not (v_accounts or private.can_access_customer(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  v_exclusive := v.agreed_amount is not null and v.agreed_tax_basis = 'EXCLUSIVE';
  select coalesce(sum(total_gst), 0) into v_inv_gst from public.generated_invoices where customer_id = v.id and payment_ledger = 'CUSTOMER';
  -- a payment without a recorded GST split is taken as taxable value, less its share of the GST of the invoices
  select coalesce(sum(coalesce(p.taxable_amount, p.amount * case when v_inv_gst > 0 and v.agreed_amount > 0 then v.agreed_amount / (v.agreed_amount + v_inv_gst) else 1 end)), 0)
    into v_taxable_paid from public.customer_payments p where p.customer_id = v.id and p.status in ('PENDING', 'VERIFIED');
  return jsonb_build_object(
    'customerId', v.id,
    'workflow', v.payment_workflow,
    'dealAmount', v.deal_amount,
    'agreedAmount', coalesce(v.agreed_amount, v.deal_amount),
    'taxBasis', case when v.agreed_amount is null then 'INCLUSIVE' else v.agreed_tax_basis end,
    'gst', jsonb_build_object(
      'allowed', v_exclusive,
      'onPayments', coalesce((select sum(gst_amount) from public.customer_payments where customer_id = v.id and status in ('PENDING', 'VERIFIED')), 0),
      'taxableBalance', case when v_exclusive then greatest(round(v.agreed_amount - v_taxable_paid, 2), 0) end),
    'order', private.order_summary(v.id),
    'recorded', v.amount_received,
    'verified', v.amount_verified,
    'pending', coalesce((select sum(amount) from public.customer_payments where customer_id = v.id and status = 'PENDING'), 0),
    'balance', greatest(coalesce(v.deal_amount, 0) - v.amount_verified, 0),
    'paymentStatus', v.payment_status,
    'accountsOwner', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = v.accounts_owner_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.payment_type, 'amount', p.amount, 'taxableAmount', p.taxable_amount, 'gstRate', p.gst_rate, 'gstAmount', p.gst_amount,
        'method', p.method, 'reference', p.reference,
        'paidAt', p.paid_at, 'status', p.status, 'source', p.source, 'note', p.note, 'statusReason', p.status_reason,
        'recordedBy', (select full_name from public.profiles where id = p.recorded_by), 'recordedAt', p.recorded_at,
        'verifiedBy', (select full_name from public.profiles where id = p.verified_by), 'verifiedAt', p.verified_at)
        order by p.paid_at desc, p.recorded_at desc)
      from public.customer_payments p where p.customer_id = v.id), '[]'::jsonb),
    'request', (select jsonb_build_object(
        'id', r.id, 'status', r.status, 'agreedAmount', r.agreed_amount, 'salesNote', r.sales_note,
        'requestedAt', r.requested_at, 'requestedBy', (select full_name from public.profiles where id = r.requested_by),
        'resolvedAt', r.resolved_at, 'resolvedBy', (select full_name from public.profiles where id = r.resolved_by),
        'resolutionNote', r.resolution_note)
      from public.payment_requests r where r.customer_id = v.id order by r.requested_at desc limit 1),
    'followUps', case when v_accounts then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'outcome', f.outcome, 'note', f.note, 'contactedAt', f.contacted_at, 'nextFollowUpAt', f.next_follow_up_at,
        'author', (select full_name from public.profiles where id = f.author_id))
        order by f.contacted_at desc)
      from public.payment_followups f where f.customer_id = v.id), '[]'::jsonb) else null end,
    'isAccounts', v_accounts);
end $$;
revoke all on function public.customer_payment_overview(uuid) from public, anon;
grant execute on function public.customer_payment_overview(uuid) to authenticated;
