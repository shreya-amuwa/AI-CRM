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
