-- Paste this whole file into the Supabase SQL editor and run it once (safe to run again). It needs the earlier migrations to be applied already.
-- 1) Super Admin protection (nobody but the Super Admin can suspend, demote or delete a Super Admin: also enforced by the database)   2) Team member contact number (separate from the emergency contact)   3) Chat: Delete for me / Delete for everyone and end-to-end encrypted internal chats   4) the client services list keeps loading if customer_onboarding.client_status is missing

-- ===== 20261206000100_super_admin_protection.sql =====
-- =============================================================================
-- The Super Admin account is the top of the hierarchy (Super Admin -> Department Head -> Team Lead -> Team Member) and cannot be
-- suspended, revoked, deleted or demoted from the application by anybody - not by a Department Head, a Team Lead, a Team Member and
-- not by another Super Admin or by itself.
--
-- The workflow functions already refuse it (private.actor_can_manage_profile: a Super Admin may manage everybody EXCEPT a Super Admin; a
-- Department Head only Team Leads and Team Members of the department; a Team Lead only Team Members of the team). This migration adds a
-- last line of defence IN THE TABLE, so a future function, a policy mistake or a hand-made request cannot get round them:
--   * UPDATE of role or status of a SUPER_ADMIN row, and DELETE of one, are refused whenever the statement runs for a signed-in person
--     (auth.uid() is set). Maintenance by the database owner / service role (auth.uid() is null: migrations, break-glass recovery) is not affected.
--   * a profile can never be turned INTO a Super Admin by a signed-in person either (the role stays "never assignable through the app").
-- Additive: two trigger functions and two triggers. No data changes.
-- =============================================================================
create or replace function private.tg_protect_super_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return case tg_op when 'DELETE' then old else new end;   -- database owner / service role: not a request of a signed-in person
  end if;
  if tg_op = 'DELETE' then
    if old.role = 'SUPER_ADMIN' then
      raise exception 'FORBIDDEN: The Super Admin account cannot be deleted from the application.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.role = 'SUPER_ADMIN' and (new.role is distinct from old.role or new.status is distinct from old.status) then
    raise exception 'FORBIDDEN: The Super Admin account cannot be suspended, revoked or demoted from the application.' using errcode = '42501';
  end if;
  if old.role <> 'SUPER_ADMIN' and new.role = 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Nobody can be made Super Admin from the application.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_protect_super_admin() from public, anon, authenticated;

drop trigger if exists profiles_protect_super_admin_update on public.profiles;
create trigger profiles_protect_super_admin_update
  before update of role, status on public.profiles
  for each row execute function private.tg_protect_super_admin();

drop trigger if exists profiles_protect_super_admin_delete on public.profiles;
create trigger profiles_protect_super_admin_delete
  before delete on public.profiles
  for each row execute function private.tg_protect_super_admin();

-- ===== 20261206000200_member_contact_number.sql =====
-- =============================================================================
-- The team member's OWN contact number, separate from the emergency contact number.
--
--   employee_personal_details.contact_number   the member's own number, stored normalised with its country code ('+919876543210').
--   employee_personal_details.emergency_contact stays as it was (never overwritten by the number above).
--
-- Both are private: this table is readable only through hr_personal_details() (HR staff and the Super Admin) and my_personal_details()
-- (the person themselves). The number is NOT copied to profiles.phone, which every colleague who can see the profile can read.
-- Existing members have no contact number yet (null); nothing is guessed or copied from the emergency contact.
-- hr_update_member_contacts() lets HR staff / the Super Admin set or correct the two numbers of one member without touching anything else.
-- Additive and safe to run again.
-- =============================================================================
alter table public.employee_personal_details add column if not exists contact_number text;
alter table public.employee_personal_details drop constraint if exists employee_personal_details_contact_number_check;
alter table public.employee_personal_details add constraint employee_personal_details_contact_number_check
  check (contact_number is null or contact_number ~ '^\+[1-9][0-9]{7,14}$');

create or replace function public.hr_personal_details()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can view employee personal details.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'profileId', d.profile_id, 'designation', d.designation, 'joiningDate', d.joining_date,
      'dateOfBirth', d.date_of_birth, 'bloodGroup', d.blood_group, 'emergencyContact', d.emergency_contact,
      'contactNumber', d.contact_number))
    from public.employee_personal_details d), '[]'::jsonb);
end $$;

create or replace function public.my_personal_details()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
      'profileId', d.profile_id, 'designation', d.designation, 'joiningDate', d.joining_date,
      'dateOfBirth', d.date_of_birth, 'bloodGroup', d.blood_group, 'emergencyContact', d.emergency_contact,
      'contactNumber', d.contact_number)
    from public.employee_personal_details d where d.profile_id = auth.uid()), 'null'::jsonb)
$$;

-- Set or correct the two numbers of one member. A null leaves that number as it is; an empty string is refused (a number is never cleared by accident).
create or replace function public.hr_update_member_contacts(p_profile uuid, p_contact text default null, p_emergency text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
  v_emergency text := nullif(btrim(coalesce(p_emergency, '')), '');
  v_row public.employee_personal_details;
begin
  if not (private.is_hr_staff() or exists (select 1 from public.profiles m where m.id = auth.uid() and m.status = 'ACTIVE' and m.role = 'SUPER_ADMIN')) then
    raise exception 'FORBIDDEN: Only HR staff and the Super Admin can change employee contact numbers.' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001'; end if;
  if p_contact is not null and v_contact is null or p_emergency is not null and v_emergency is null then
    raise exception 'VALIDATION_ERROR: A contact number cannot be cleared; enter the correct number.' using errcode = 'P0001';
  end if;
  if v_contact is not null and v_contact !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'VALIDATION_ERROR: Enter the contact number with its country code, for example +919876543210.' using errcode = 'P0001';
  end if;
  if v_emergency is not null and (v_emergency !~ '^\+?[0-9 ()-]{7,20}$' or length(regexp_replace(v_emergency, '\D', '', 'g')) not between 10 and 15) then
    raise exception 'VALIDATION_ERROR: Enter a valid emergency contact number (10 to 15 digits).' using errcode = 'P0001';
  end if;
  insert into public.employee_personal_details (profile_id) values (p_profile) on conflict (profile_id) do nothing;
  update public.employee_personal_details
     set contact_number = coalesce(v_contact, contact_number), emergency_contact = coalesce(v_emergency, emergency_contact), updated_at = now()
   where profile_id = p_profile returning * into v_row;
  if v_row.contact_number is not null and v_row.emergency_contact is not null
     and right(regexp_replace(v_row.contact_number, '\D', '', 'g'), 10) = right(regexp_replace(v_row.emergency_contact, '\D', '', 'g'), 10) then
    raise exception 'VALIDATION_ERROR: The emergency contact must be a different number from the member''s own number.' using errcode = 'P0001';
  end if;
  perform private.write_audit('EMPLOYEE_CONTACTS_UPDATED', 'profile', t.id, t.department_id, t.team_id,
    jsonb_build_object('contact_changed', v_contact is not null, 'emergency_changed', v_emergency is not null));
  return jsonb_build_object('profileId', v_row.profile_id, 'contactNumber', v_row.contact_number, 'emergencyContact', v_row.emergency_contact);
end $$;
revoke all on function public.hr_update_member_contacts(uuid, text, text) from public, anon;
grant execute on function public.hr_update_member_contacts(uuid, text, text) to authenticated;

-- ===== 20261206000300_chat_deletion_and_e2ee.sql =====
-- =============================================================================
-- Chat: WhatsApp-style message deletion and end-to-end encryption of the INTERNAL chats (direct messages and groups).
--
-- DELETION
--   Delete for me        a per-person row in chat_message_hidden. The shared message is untouched; the message never comes back for that
--                        person (every device, every login) and never for anybody else.
--   Delete for everyone  only the sender, only in internal chats. The row stays as a tombstone (the conversation numbering does not
--                        change) but everything that could be read is wiped in the same statement: body, ciphertext, key wraps, the file
--                        list. The files are marked DELETED here and removed from storage by the API (storage_removed_at records it).
--                        The deletion is written to the audit log (ids and counts only, never content).
--   Not for client conversations: those are reviewed by the Department Head and kept for the client and the team.
--
-- END-TO-END ENCRYPTION (internal chats only)
--   The server stores and moves ciphertext. It never receives a message key, a private key, a recovery passphrase or a plaintext body.
--   * each person has one identity key pair (ECDH P-256). The PRIVATE key is made in the browser and kept there (IndexedDB, non-extractable);
--     a copy encrypted with a recovery passphrase the server never sees is kept in chat_key_backups so a new device can restore it.
--   * the PUBLIC key, its version and its fingerprint are in chat_user_keys (a directory of public keys; it holds no secret).
--   * a message is encrypted in the sender's browser with a random AES-256-GCM key; that key is sealed for every current member with
--     HPKE (RFC 9180, DHKEM P-256 / HKDF-SHA256 / AES-256-GCM) in AUTHENTICATED mode, so a recipient also knows who sealed it.
--   * the server checks the SHAPE (who is covered, which key versions) but cannot check the content: that is the point.
--   * a plaintext message in a DIRECT or GROUP conversation is refused by a trigger, whichever function tries to store it.
--   * what the server can still see: who talks to whom, when, message and file sizes, and the sender's name. Not what is said.
--   Old messages (sent before this migration) stay readable as they were and are labelled as not end-to-end encrypted by the screens.
-- Additive; safe to run again. Nothing is deleted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns and tables
-- ---------------------------------------------------------------------------
alter table public.chat_messages add column if not exists deleted_at timestamptz;
alter table public.chat_messages add column if not exists deleted_by uuid;
alter table public.chat_messages add column if not exists encrypted boolean not null default false;
alter table public.chat_messages add column if not exists e2ee jsonb;
alter table public.chat_messages drop constraint if exists chat_messages_e2ee_shape;
alter table public.chat_messages add constraint chat_messages_e2ee_shape
  check (not encrypted or deleted_at is not null or (body = '' and e2ee is not null and jsonb_typeof(e2ee) = 'object' and length(e2ee::text) <= 262144));

alter table public.chat_attachments add column if not exists deleted_at timestamptz;
alter table public.chat_attachments add column if not exists storage_removed_at timestamptz;
alter table public.chat_attachments drop constraint if exists chat_attachments_status_check;
alter table public.chat_attachments add constraint chat_attachments_status_check check (status in ('PENDING', 'READY', 'FAILED', 'DELETED'));
-- an encrypted file is a little larger than the file (header, nonce, tag)
alter table public.chat_attachments drop constraint if exists chat_attachments_size_bytes_check;
alter table public.chat_attachments add constraint chat_attachments_size_bytes_check check (size_bytes > 0 and size_bytes <= 5242944);

do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = (select array(select distinct x from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['application/x-amuwa-e2ee']) x)),
           file_size_limit = 5242944
     where id = 'chat-attachments';
  end if;
end $$;

create table if not exists public.chat_message_hidden (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);
create index if not exists chat_message_hidden_person_idx on public.chat_message_hidden (profile_id, conversation_id);

-- Public keys of the people who use secure chat (a directory: it holds no secret). One ACTIVE key per person; a reset retires it.
create table if not exists public.chat_user_keys (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  key_version integer not null check (key_version >= 1),
  public_key text not null check (length(public_key) = 88),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (profile_id, key_version)
);
create unique index if not exists chat_user_keys_active_idx on public.chat_user_keys (profile_id) where retired_at is null;

-- The identity private key(s), encrypted IN THE BROWSER with a recovery passphrase the server never sees. Opaque to the server.
create table if not exists public.chat_key_backups (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  key_version integer not null,
  blob jsonb not null check (jsonb_typeof(blob) = 'object' and length(blob::text) <= 60000),
  updated_at timestamptz not null default now()
);

alter table public.chat_message_hidden enable row level security;
alter table public.chat_user_keys enable row level security;
alter table public.chat_key_backups enable row level security;
revoke all on public.chat_message_hidden, public.chat_user_keys, public.chat_key_backups from public, anon, authenticated;
-- no policy and no grant: these tables are reached only through the functions below

-- ---------------------------------------------------------------------------
-- 2. A readable message may never be stored in an internal chat
-- ---------------------------------------------------------------------------
create or replace function private.tg_chat_require_encryption()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'TEXT' and not new.encrypted
     and exists (select 1 from public.chat_conversations c where c.id = new.conversation_id and c.kind in ('DIRECT', 'GROUP')) then
    raise exception 'VALIDATION_ERROR: Messages in this chat are end-to-end encrypted. Reload the page and try again.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_chat_require_encryption() from public, anon, authenticated;
drop trigger if exists chat_messages_require_encryption on public.chat_messages;
create trigger chat_messages_require_encryption before insert on public.chat_messages
  for each row execute function private.tg_chat_require_encryption();

-- ---------------------------------------------------------------------------
-- 3. How a message reaches the screens
-- ---------------------------------------------------------------------------
-- A tombstone has no body, no files and no ciphertext. An encrypted message carries only the viewer's own key wrap.
create or replace function private.chat_message_json(m public.chat_messages)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'conversationId', m.conversation_id, 'seq', m.seq, 'mine', m.sender_id is not distinct from auth.uid() and m.sender_id is not null,
    'senderKind', m.sender_kind, 'senderName', m.sender_name, 'senderLabel', m.sender_label, 'kind', m.kind,
    'deleted', m.deleted_at is not null,
    'body', case when m.deleted_at is null then m.body else '' end,
    'attachments', case when m.deleted_at is null then m.attachments else '[]'::jsonb end,
    'clientMsgId', m.client_msg_id, 'createdAt', m.created_at,
    'encrypted', m.encrypted, 'senderId', case when m.encrypted then m.sender_id end,
    'e2ee', case when m.encrypted and m.deleted_at is null and m.e2ee is not null then jsonb_build_object(
        'v', m.e2ee -> 'v', 'sv', m.e2ee -> 'sv', 'iv', m.e2ee -> 'iv', 'ct', m.e2ee -> 'ct',
        'wrap', (select w from jsonb_array_elements(m.e2ee -> 'wraps') w where w ->> 'to' = auth.uid()::text limit 1)) end,
    'replyTo', (select jsonb_build_object('id', r.id, 'seq', r.seq, 'senderName', r.sender_name,
                  'body', case when r.deleted_at is null and not r.encrypted then left(r.body, 140) else '' end, 'deleted', r.deleted_at is not null)
                  from public.chat_messages r where r.id = m.reply_to))
$$;
revoke all on function private.chat_message_json(public.chat_messages) from public, anon;

-- Unread counts skip what was deleted and what the person hid.
create or replace function private.chat_unread(p_conversation uuid, p_user uuid, p_from bigint)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.chat_messages m
   where m.conversation_id = p_conversation and m.kind = 'TEXT' and m.deleted_at is null and m.sender_id is distinct from p_user
     and not exists (select 1 from public.chat_message_hidden h where h.message_id = m.id and h.profile_id = p_user)
     and m.seq > greatest(coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = p_conversation and r.user_id = p_user), 0), coalesce(p_from, 0))
$$;
revoke all on function private.chat_unread(uuid, uuid, bigint) from public, anon;

-- One page of history. Messages the person hid are not part of it. When a screen asks for "everything after N" it also learns which
-- of the messages it already has were deleted for everyone meanwhile (so a deleted message cannot linger on a screen that missed the live event).
create or replace function public.chat_messages_page(p_conversation uuid, p_before_seq bigint default null, p_after_seq bigint default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  a text;
  me uuid := auth.uid();
  v_from bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows public.chat_messages[];
  v_more boolean := false;
  v_deleted jsonb := '[]'::jsonb;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  v_from := case when a = 'MEMBER' then private.chat_visible_from(c.id) else 0 end;
  if p_after_seq is not null then
    select coalesce(array_agg(m order by m.seq), '{}') into v_rows from (
      select * from public.chat_messages x where x.conversation_id = c.id and x.seq > greatest(p_after_seq, v_from)
         and not exists (select 1 from public.chat_message_hidden h where h.message_id = x.id and h.profile_id = me)
       order by x.seq limit 200) m;
    select coalesce(jsonb_agg(x.id), '[]'::jsonb) into v_deleted from (
      select d.id from public.chat_messages d
       where d.conversation_id = c.id and d.deleted_at is not null and d.seq > v_from and d.seq <= p_after_seq and d.seq > p_after_seq - 500
       order by d.seq desc limit 200) x;
  else
    select coalesce(array_agg(m order by m.seq), '{}') into v_rows from (
      select * from public.chat_messages x where x.conversation_id = c.id and x.seq > v_from and (p_before_seq is null or x.seq < p_before_seq)
         and not exists (select 1 from public.chat_message_hidden h where h.message_id = x.id and h.profile_id = me)
       order by x.seq desc limit v_limit) m;
    v_more := exists (select 1 from public.chat_messages x where x.conversation_id = c.id and x.seq > v_from
                         and x.seq < coalesce((select min(r.seq) from unnest(v_rows) r), 0)
                         and not exists (select 1 from public.chat_message_hidden h where h.message_id = x.id and h.profile_id = me));
  end if;
  return jsonb_build_object(
    'messages', coalesce((select jsonb_agg(private.chat_message_json(r) order by r.seq) from unnest(v_rows) r), '[]'::jsonb),
    'hasMore', v_more, 'lastSeq', c.last_seq, 'deletedIds', v_deleted);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Deleting messages
-- ---------------------------------------------------------------------------
create or replace function public.chat_delete_for_me(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.chat_messages;
  c public.chat_conversations;
  me uuid := private.my_id();
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into m from public.chat_messages where id = p_message;
  select * into c from public.chat_conversations where id = m.conversation_id;
  if m.id is null or c.id is null or not private.chat_message_visible(c.id, m.seq) then
    raise exception 'NOT_FOUND: Message not found.' using errcode = 'P0001';
  end if;
  if c.kind = 'CLIENT' then
    raise exception 'FORBIDDEN: Messages of a client conversation are kept for the client and the team.' using errcode = '42501';
  end if;
  insert into public.chat_message_hidden (message_id, profile_id, conversation_id) values (m.id, me, c.id) on conflict (message_id, profile_id) do nothing;
  return jsonb_build_object('id', m.id, 'hidden', true);
end $$;
revoke all on function public.chat_delete_for_me(uuid) from public, anon;
grant execute on function public.chat_delete_for_me(uuid) to authenticated;

-- Only the sender, only in an internal chat. Returns the files whose stored objects the API must still remove.
create or replace function public.chat_delete_for_everyone(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.chat_messages;
  c public.chat_conversations;
  me uuid := private.my_id();
  v_files jsonb;
  v_count integer;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into m from public.chat_messages where id = p_message for update;
  select * into c from public.chat_conversations where id = m.conversation_id;
  if m.id is null or c.id is null or not private.chat_message_visible(c.id, m.seq) then
    raise exception 'NOT_FOUND: Message not found.' using errcode = 'P0001';
  end if;
  if c.kind = 'CLIENT' then
    raise exception 'FORBIDDEN: Messages of a client conversation are kept for the client and the team.' using errcode = '42501';
  end if;
  if m.kind <> 'TEXT' or m.sender_id is distinct from me then
    raise exception 'FORBIDDEN: You can delete for everyone only the messages you sent.' using errcode = '42501';
  end if;
  if m.deleted_at is null then
    update public.chat_messages set body = '', attachments = '[]'::jsonb, e2ee = null, deleted_at = now(), deleted_by = me where id = m.id;
    update public.chat_attachments set status = 'DELETED', deleted_at = now() where message_id = m.id and status <> 'DELETED';
    get diagnostics v_count = row_count;
    -- the conversation list and the other screens learn about it
    update public.chat_conversations
       set last_message_preview = case when m.seq = last_seq then 'This message was deleted' else last_message_preview end, updated_at = clock_timestamp()
     where id = c.id;
    perform private.write_audit('CHAT_MESSAGE_DELETED_FOR_ALL', 'chat_message', m.id, null, null,
      jsonb_build_object('conversation', c.id, 'seq', m.seq, 'encrypted', m.encrypted, 'files', v_count));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'bucket', t.storage_bucket, 'path', t.storage_path, 'provider', t.storage_provider)), '[]'::jsonb)
    into v_files from public.chat_attachments t where t.message_id = m.id and t.storage_removed_at is null;
  return jsonb_build_object('id', m.id, 'deleted', true, 'files', v_files);
end $$;
revoke all on function public.chat_delete_for_everyone(uuid) from public, anon;
grant execute on function public.chat_delete_for_everyone(uuid) to authenticated;

-- The API removed the stored objects: record it (only for the files of the person's own deleted message).
create or replace function public.chat_attachments_removed(p_ids uuid[])
returns void language sql security definer set search_path = '' as $$
  update public.chat_attachments set storage_removed_at = now()
   where id = any (p_ids) and status = 'DELETED' and uploader_id = auth.uid() and storage_removed_at is null
$$;
revoke all on function public.chat_attachments_removed(uuid[]) from public, anon;
grant execute on function public.chat_attachments_removed(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Keys: a directory of public keys, and an encrypted backup of the private key
-- ---------------------------------------------------------------------------
create or replace function private.chat_public_key_ok(p_key text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_bytes bytea;
begin
  if p_key is null or length(p_key) <> 88 or p_key !~ '^[A-Za-z0-9+/]+={0,2}$' then
    return false;
  end if;
  v_bytes := decode(p_key, 'base64');
  -- an uncompressed P-256 point: 0x04 followed by X and Y (32 bytes each)
  return length(v_bytes) = 65 and get_byte(v_bytes, 0) = 4;
exception when others then
  return false;
end $$;

create or replace function private.chat_backup_ok(p_blob jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_blob is not null and jsonb_typeof(p_blob) = 'object' and length(p_blob::text) <= 60000
     and p_blob ? 'v' and p_blob ? 'salt' and p_blob ? 'iv' and p_blob ? 'ct' and p_blob ? 'iter'
$$;

create or replace function private.chat_key_json(k public.chat_user_keys)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('profileId', k.profile_id, 'keyVersion', k.key_version, 'publicKey', k.public_key, 'fingerprint', k.fingerprint,
                            'retired', k.retired_at is not null)
$$;

create or replace function public.chat_key_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  k public.chat_user_keys;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into k from public.chat_user_keys where profile_id = me and retired_at is null;
  return jsonb_build_object('hasKey', k.profile_id is not null, 'version', k.key_version, 'publicKey', k.public_key, 'fingerprint', k.fingerprint,
                            'hasBackup', exists (select 1 from public.chat_key_backups b where b.profile_id = me));
end $$;

revoke all on function public.chat_key_status() from public, anon;
grant execute on function public.chat_key_status() to authenticated;

-- First setup: publishes the public key and stores the passphrase-encrypted backup. Refused when a key already exists.
create or replace function public.chat_key_setup(p_public text, p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_ver integer;
  v_fp text;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.chat_public_key_ok(p_public) or not private.chat_backup_ok(p_backup) then
    raise exception 'VALIDATION_ERROR: The key or its backup is not valid.' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = me for update;   -- one setup at a time
  if exists (select 1 from public.chat_user_keys where profile_id = me and retired_at is null) then
    raise exception 'CONFLICT: Secure messaging is already set up for this account. Unlock it with your recovery passphrase.' using errcode = 'P0001';
  end if;
  select coalesce(max(key_version), 0) + 1 into v_ver from public.chat_user_keys where profile_id = me;
  v_fp := encode(sha256(decode(p_public, 'base64')), 'hex');
  insert into public.chat_user_keys (profile_id, key_version, public_key, fingerprint) values (me, v_ver, p_public, v_fp);
  insert into public.chat_key_backups (profile_id, key_version, blob) values (me, v_ver, p_backup)
  on conflict (profile_id) do update set key_version = excluded.key_version, blob = excluded.blob, updated_at = now();
  perform private.write_audit('CHAT_KEY_REGISTERED', 'profile', me, null, null, jsonb_build_object('version', v_ver, 'fingerprint', v_fp));
  return jsonb_build_object('version', v_ver, 'fingerprint', v_fp);
end $$;
revoke all on function public.chat_key_setup(text, jsonb) from public, anon;
grant execute on function public.chat_key_setup(text, jsonb) to authenticated;

-- A reset (lost passphrase and device, or on purpose): the current key is retired and a new one published. Messages sealed for the old
-- key can no longer be read by this person; other people are told the key changed (their screens compare fingerprints).
create or replace function public.chat_key_reset(p_public text, p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_ver integer;
  v_fp text;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.chat_public_key_ok(p_public) or not private.chat_backup_ok(p_backup) then
    raise exception 'VALIDATION_ERROR: The key or its backup is not valid.' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = me for update;
  update public.chat_user_keys set retired_at = now() where profile_id = me and retired_at is null;
  select coalesce(max(key_version), 0) + 1 into v_ver from public.chat_user_keys where profile_id = me;
  v_fp := encode(sha256(decode(p_public, 'base64')), 'hex');
  insert into public.chat_user_keys (profile_id, key_version, public_key, fingerprint) values (me, v_ver, p_public, v_fp);
  insert into public.chat_key_backups (profile_id, key_version, blob) values (me, v_ver, p_backup)
  on conflict (profile_id) do update set key_version = excluded.key_version, blob = excluded.blob, updated_at = now();
  perform private.write_audit('CHAT_KEYS_RESET', 'profile', me, null, null, jsonb_build_object('version', v_ver, 'fingerprint', v_fp));
  return jsonb_build_object('version', v_ver, 'fingerprint', v_fp);
end $$;
revoke all on function public.chat_key_reset(text, jsonb) from public, anon;
grant execute on function public.chat_key_reset(text, jsonb) to authenticated;

-- Replace the backup of the CURRENT key version (a new recovery passphrase, or older key versions added to it).
create or replace function public.chat_key_backup_set(p_backup jsonb, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.chat_backup_ok(p_backup) then
    raise exception 'VALIDATION_ERROR: The backup is not valid.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.chat_user_keys where profile_id = me and retired_at is null and key_version = p_version) then
    raise exception 'CONFLICT: Your key changed. Reload the page.' using errcode = 'P0001';
  end if;
  update public.chat_key_backups set blob = p_backup, key_version = p_version, updated_at = now() where profile_id = me;
end $$;
revoke all on function public.chat_key_backup_set(jsonb, integer) from public, anon;
grant execute on function public.chat_key_backup_set(jsonb, integer) to authenticated;

-- Your own encrypted backup (to unlock secure messaging on another device). Nobody else's, ever.
create or replace function public.chat_key_backup_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  b public.chat_key_backups;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into b from public.chat_key_backups where profile_id = me;
  if b.profile_id is null then
    return null;
  end if;
  return jsonb_build_object('version', b.key_version, 'blob', b.blob);
end $$;
revoke all on function public.chat_key_backup_get() from public, anon;
grant execute on function public.chat_key_backup_get() to authenticated;

-- The current public key of every member of a conversation the person belongs to (or null where somebody has not set up secure messaging).
create or replace function public.chat_member_keys(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.chat_access(p_conversation) is distinct from 'MEMBER' then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.full_name, 'keyVersion', k.key_version, 'publicKey', k.public_key, 'fingerprint', k.fingerprint)
                     order by p.full_name)
      from public.chat_members m join public.profiles p on p.id = m.profile_id
      left join public.chat_user_keys k on k.profile_id = p.id and k.retired_at is null
     where m.conversation_id = p_conversation and m.left_at is null), '[]'::jsonb);
end $$;
revoke all on function public.chat_member_keys(uuid) from public, anon;
grant execute on function public.chat_member_keys(uuid) to authenticated;

-- One public key by version (to verify who sealed an older message). Public keys are not secret; only employees may ask.
create or replace function public.chat_key_lookup(p_profile uuid, p_version integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k public.chat_user_keys;
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into k from public.chat_user_keys where profile_id = p_profile and key_version = p_version;
  if k.profile_id is null then
    return null;
  end if;
  return private.chat_key_json(k);
end $$;
revoke all on function public.chat_key_lookup(uuid, integer) from public, anon;
grant execute on function public.chat_key_lookup(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sending an encrypted message
-- ---------------------------------------------------------------------------
-- p_e2ee = {"v":1,"sv":<sender key version>,"iv":"<b64>","ct":"<b64>","wraps":[{"to":"<profile>","kv":<version>,"enc":"<b64>","w":"<b64>"}, ...]}
-- The server checks WHO is covered and with which key version; it cannot (and must not be able to) read the content.
create or replace function public.chat_send_encrypted(
  p_conversation uuid, p_client_msg_id uuid, p_e2ee jsonb, p_reply_to uuid default null, p_attachments uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  me uuid := private.my_id();
  v_existing public.chat_messages;
  v_msg public.chat_messages;
  v_seq bigint;
  v_name text;
  v_n integer := coalesce(array_length(p_attachments, 1), 0);
  v_found integer;
  v_atts jsonb := '[]'::jsonb;
  v_my_ver integer;
  v_missing text;
  v_need jsonb;
  v_have jsonb;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or private.chat_access(c.id) is distinct from 'MEMBER' or c.kind not in ('DIRECT', 'GROUP') then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if p_client_msg_id is null then
    raise exception 'VALIDATION_ERROR: The message has no identifier. Please try again.' using errcode = 'P0001';
  end if;
  select * into v_existing from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
  if v_existing.id is not null then
    return private.chat_message_json(v_existing);
  end if;
  if p_e2ee is null or jsonb_typeof(p_e2ee) <> 'object' or length(p_e2ee::text) > 262144
     or (p_e2ee -> 'v') is distinct from '1'::jsonb
     or jsonb_typeof(p_e2ee -> 'iv') <> 'string' or jsonb_typeof(p_e2ee -> 'ct') <> 'string' or jsonb_typeof(p_e2ee -> 'wraps') <> 'array'
     or length(p_e2ee ->> 'ct') < 8 or length(p_e2ee ->> 'ct') > 90000 or length(p_e2ee ->> 'iv') <> 16 then
    raise exception 'VALIDATION_ERROR: The message could not be encrypted. Reload the page and try again.' using errcode = 'P0001';
  end if;
  if v_n > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files to one message.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_messages x where x.sender_id = me and x.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'VALIDATION_ERROR: You are sending messages too fast. Wait a moment and try again.' using errcode = 'P0001';
  end if;

  -- everybody who is in the conversation now must have set up secure messaging, and the message must be sealed for each one's CURRENT key
  select string_agg(p.full_name, ', ' order by p.full_name) into v_missing
    from public.chat_members m join public.profiles p on p.id = m.profile_id
   where m.conversation_id = c.id and m.left_at is null
     and not exists (select 1 from public.chat_user_keys k where k.profile_id = p.id and k.retired_at is null);
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: KEYS_MISSING: % has not set up secure messaging yet. Ask them to open Chat once, then try again.', v_missing using errcode = 'P0001';
  end if;
  select k.key_version into v_my_ver from public.chat_user_keys k where k.profile_id = me and k.retired_at is null;
  if (p_e2ee ->> 'sv')::integer is distinct from v_my_ver then
    raise exception 'CONFLICT: KEYS_CHANGED: Your secure messaging key changed. Reload the page.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(m.profile_id::text, k.key_version) order by m.profile_id::text collate "C"), '[]'::jsonb) into v_need
    from public.chat_members m join public.chat_user_keys k on k.profile_id = m.profile_id and k.retired_at is null
   where m.conversation_id = c.id and m.left_at is null;
  select coalesce(jsonb_agg(jsonb_build_array(w ->> 'to', (w ->> 'kv')::integer) order by (w ->> 'to') collate "C"), '[]'::jsonb) into v_have
    from jsonb_array_elements(p_e2ee -> 'wraps') w
   where jsonb_typeof(w) = 'object' and jsonb_typeof(w -> 'enc') = 'string' and jsonb_typeof(w -> 'w') = 'string'
     and (w ->> 'kv') ~ '^[0-9]{1,9}$' and length(w ->> 'enc') = 88 and length(coalesce(w ->> 'w', '')) between 16 and 400;
  if v_need is distinct from v_have then
    raise exception 'CONFLICT: KEYS_CHANGED: The people in this chat or their keys changed. Reload the page and send again.' using errcode = 'P0001';
  end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages r where r.id = p_reply_to and r.conversation_id = c.id) then
    raise exception 'VALIDATION_ERROR: The message you are replying to was not found.' using errcode = 'P0001';
  end if;
  if v_n > 0 then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'size', t.size_bytes) order by t.created_at), '[]'::jsonb)
      into v_found, v_atts from public.chat_attachments t
     where t.id = any (p_attachments) and t.conversation_id = c.id and t.uploader_id = me and t.status = 'READY' and t.message_id is null
       and t.mime_type = 'application/x-amuwa-e2ee';
    if v_found <> v_n then
      raise exception 'VALIDATION_ERROR: One of the files is not ready or was already sent. Upload it again.' using errcode = 'P0001';
    end if;
  end if;

  select p.full_name into v_name from public.profiles p where p.id = me;
  update public.chat_conversations
     set last_seq = last_seq + 1, last_message_at = now(), updated_at = now(), last_message_preview = 'Encrypted message', last_sender_name = v_name
   where id = c.id returning last_seq into v_seq;
  begin
    insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, sender_label, kind, body, reply_to, client_msg_id, attachments, encrypted, e2ee)
    values (c.id, v_seq, me, 'STAFF', v_name, null, 'TEXT', '', p_reply_to, p_client_msg_id, v_atts, true, p_e2ee)
    returning * into v_msg;
  exception when unique_violation then
    select * into v_msg from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
    return private.chat_message_json(v_msg);
  end;
  if v_n > 0 then
    update public.chat_attachments set message_id = v_msg.id where id = any (p_attachments);
  end if;
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq) values (c.id, me, v_seq)
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
  return private.chat_message_json(v_msg);
end $$;
revoke all on function public.chat_send_encrypted(uuid, uuid, jsonb, uuid, uuid[]) from public, anon;
grant execute on function public.chat_send_encrypted(uuid, uuid, jsonb, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Files: in an internal chat the file is encrypted in the browser, so only an opaque encrypted file is accepted
-- ---------------------------------------------------------------------------
create or replace function public.chat_begin_upload(p_conversation uuid, p_file_name text, p_mime text, p_size bigint)
returns public.chat_attachments language plpgsql security definer set search_path = '' as $$
declare
  a text := private.chat_access(p_conversation);
  me uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  v_kind text;
  v_secure boolean;
  v_max bigint;
  r public.chat_attachments;
begin
  if a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if a = 'REVIEWER' then
    raise exception 'FORBIDDEN: You can read this conversation as a reviewer, but you cannot send files in it.' using errcode = '42501';
  end if;
  select kind into v_kind from public.chat_conversations where id = p_conversation;
  v_secure := v_kind in ('DIRECT', 'GROUP');
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if v_secure then
    if p_mime is distinct from 'application/x-amuwa-e2ee' then
      raise exception 'VALIDATION_ERROR: Files in this chat are encrypted before they are sent. Reload the page and try again.' using errcode = 'P0001';
    end if;
  elsif p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'VALIDATION_ERROR: This file type cannot be sent. Use an image, PDF, text, CSV, Word or Excel file.' using errcode = 'P0001';
  end if;
  v_max := case when v_secure then 5242944 else 5242880 end;
  if p_size is null or p_size < 1 or p_size > v_max then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_attachments t where t.uploader_id = me and t.status = 'PENDING' and t.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  update public.chat_attachments set status = 'FAILED' where uploader_id = me and status = 'PENDING' and created_at < now() - interval '1 day';
  insert into public.chat_attachments (id, conversation_id, uploader_id, file_name, mime_type, size_bytes, storage_path)
  values (v_id, p_conversation, me, case when v_secure then 'encrypted-file' else v_name end, p_mime, p_size,
          format('%s/%s/%s', p_conversation, v_id, case when v_secure then 'file.enc' else private.chat_clean_name(v_name) end))
  returning * into r;
  return r;
end $$;

create or replace function public.chat_complete_upload(p_attachment uuid, p_size bigint, p_etag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.chat_attachments;
begin
  select * into r from public.chat_attachments t where t.id = p_attachment and t.uploader_id = auth.uid() and t.status = 'PENDING';
  if r.id is null or private.chat_access(r.conversation_id) is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > (case when r.mime_type = 'application/x-amuwa-e2ee' then 5242944 else 5242880 end) then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.chat_attachments set status = 'READY', size_bytes = p_size, storage_etag = coalesce(p_etag, storage_etag) where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'name', r.file_name, 'mime', r.mime_type, 'size', r.size_bytes);
end $$;

-- A deleted file is never downloadable (status DELETED is not READY).
create or replace function public.chat_attachment_download(p_attachment uuid)
returns public.chat_attachments language plpgsql stable security definer set search_path = '' as $$
declare
  r public.chat_attachments;
  m public.chat_messages;
begin
  select * into r from public.chat_attachments t where t.id = p_attachment and t.status = 'READY' and t.deleted_at is null;
  if r.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  if r.message_id is null then
    if r.uploader_id is distinct from auth.uid() or private.chat_access(r.conversation_id) is null then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
  else
    select * into m from public.chat_messages where id = r.message_id;
    if m.deleted_at is not null or not private.chat_message_visible(m.conversation_id, m.seq)
       or exists (select 1 from public.chat_message_hidden h where h.message_id = m.id and h.profile_id = auth.uid()) then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
  end if;
  return r;
end $$;

-- ===== 20261206000400_client_service_state_missing_column.sql =====
-- Whether a service is live: the same rules as 20261205000400, but reading customer_onboarding.client_status through to_jsonb(), so the client's
-- services list still loads on a database where that column has not been added yet (the API test "services still load when
-- customer_onboarding.client_status is missing" failed intermittently because this function named the column directly). No change in behaviour
-- when the column exists. Safe to run again.
create or replace function private.client_service_state(p_customer uuid, p_service text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  cs public.customer_services;
  sv public.crm_services;
  o public.customer_onboarding;
  c public.customers;
begin
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  if cs.customer_id is null then
    return 'SETTING_UP';
  end if;
  if cs.service_status is not null then
    return cs.service_status;
  end if;
  if cs.activated_at is not null then
    return 'LIVE';
  end if;
  select * into c from public.customers where id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into sv from public.crm_services where code = p_service;
  if c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING') then
    if sv.requires_technical_consultant and coalesce(o.verification_route, case when sv.requires_meta_verification then 'META' else 'TECHNICAL' end) = 'META'
       and (o.meta_completed_at is not null or (to_jsonb(o) ->> 'client_status') = 'COMPLETED') then
      return 'LIVE';
    end if;
    return 'SETTING_UP';
  end if;
  -- (before Phase C a WhatsApp customer was live once its status reached COMPLETED; that still holds)
  return case when coalesce((to_jsonb(o) ->> 'client_status') = 'COMPLETED' or o.stage = 'COMPLETED', true) then 'LIVE' else 'SETTING_UP' end;
end $$;
revoke all on function private.client_service_state(uuid, text) from public, anon, authenticated;
