-- =============================================================================
-- Internal chat without key set-up: NEW direct and group messages are stored readable by the company (option B of
-- docs/CHAT_ENCRYPTION_DECISION.md, approved by the product owner). Run after 20261224000100. Safe to run again.
--
-- Why: an employee could not send in a direct or group chat until the browser had made and published an encryption key. When that failed
-- ("Secure messaging could not be set up automatically", e.g. the key-registration function missing on the server, a browser that cannot keep
-- keys, a new device) the composer stayed locked and only a recovery passphrase was offered. The database itself refused a readable message
-- (trigger chat_messages_require_encryption) and a readable file (chat_begin_upload) in these chats.
--
-- What changes (additive, nothing converted or deleted):
--   * chat_settings: one row, internal_mode 'STANDARD' (new messages readable by the server, protected by TLS, encryption at rest and the same
--     membership checks) or 'E2EE' (the previous behaviour). It is created as STANDARD. The Super Admin can switch it back
--     (chat_set_internal_mode, audited) - the rollback lever, no deploy needed.
--   * The two database rules above accept a readable message / file in STANDARD mode. Encrypted messages are still accepted (an older browser
--     that has not reloaded keeps working), so the database never rejects what either app version sends.
--   * chat_internal_mode(): what the app asks before it decides how to send. An app that cannot reach it keeps the encrypted behaviour.
--   * Existing ciphertext, key directory, backups, message ids, timestamps and audit history are untouched. Old encrypted messages stay readable
--     on a device that holds the key; elsewhere they are shown as unavailable, without blocking anything.
--   * Membership, the client-chat stage rules, Delete for me / for everyone, read state, files, rate limits: unchanged (the existing
--     chat_send_message / chat_begin_upload paths, which already serve the client conversations, are used).
-- =============================================================================

create table if not exists public.chat_settings (
  id boolean primary key default true check (id),
  internal_mode text not null default 'STANDARD' check (internal_mode in ('STANDARD', 'E2EE')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.chat_settings (id, internal_mode) values (true, 'STANDARD') on conflict (id) do nothing;
alter table public.chat_settings enable row level security;
revoke all on public.chat_settings from public, anon, authenticated;   -- read through chat_internal_mode(), written through chat_set_internal_mode()

create or replace function private.chat_internal_mode()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select s.internal_mode from public.chat_settings s where s.id), 'E2EE')
$$;
revoke all on function private.chat_internal_mode() from public, anon;
grant execute on function private.chat_internal_mode() to authenticated, service_role;

create or replace function public.chat_internal_mode()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_id() is null and private.my_client_customer() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return jsonb_build_object('mode', private.chat_internal_mode());
end $$;
revoke all on function public.chat_internal_mode() from public, anon;
grant execute on function public.chat_internal_mode() to authenticated;

create or replace function public.chat_set_internal_mode(p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_mode text := upper(btrim(coalesce(p_mode, '')));
  v_before text := private.chat_internal_mode();
begin
  perform private.require_super_admin();
  if v_mode not in ('STANDARD', 'E2EE') then
    raise exception 'VALIDATION_ERROR: Choose STANDARD or E2EE.' using errcode = 'P0001';
  end if;
  insert into public.chat_settings (id, internal_mode, updated_by, updated_at) values (true, v_mode, auth.uid(), now())
  on conflict (id) do update set internal_mode = excluded.internal_mode, updated_by = excluded.updated_by, updated_at = now();
  if v_before is distinct from v_mode then
    perform private.write_audit('CHAT_INTERNAL_MODE_SET', 'chat_settings', null, null, null, jsonb_build_object('before', v_before, 'after', v_mode));
  end if;
  return jsonb_build_object('mode', v_mode);
end $$;
revoke all on function public.chat_set_internal_mode(text) from public, anon;
grant execute on function public.chat_set_internal_mode(text) to authenticated;

-- A readable message in a direct / group chat: accepted in STANDARD mode only (E2EE mode keeps the previous refusal).
create or replace function private.tg_chat_require_encryption()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'TEXT' and not new.encrypted and private.chat_internal_mode() = 'E2EE'
     and exists (select 1 from public.chat_conversations c where c.id = new.conversation_id and c.kind in ('DIRECT', 'GROUP')) then
    raise exception 'VALIDATION_ERROR: Messages in this chat are end-to-end encrypted. Reload the page and try again.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_chat_require_encryption() from public, anon, authenticated;
drop trigger if exists chat_messages_require_encryption on public.chat_messages;
create trigger chat_messages_require_encryption before insert on public.chat_messages
  for each row execute function private.tg_chat_require_encryption();

-- Files: in STANDARD mode a direct / group chat takes the same file types as a client chat (and still an encrypted file from an older browser).
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
  if private.chat_block_reason(p_conversation) is not null then
    raise exception 'VALIDATION_ERROR: %', private.chat_block_reason(p_conversation) using errcode = 'P0001';
  end if;
  select kind into v_kind from public.chat_conversations where id = p_conversation;
  -- an encrypted file: always in E2EE mode; in STANDARD mode only when the browser still sends one
  v_secure := v_kind in ('DIRECT', 'GROUP') and (private.chat_internal_mode() = 'E2EE' or p_mime = 'application/x-amuwa-e2ee');
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
revoke all on function public.chat_begin_upload(uuid, text, text, bigint) from public, anon;
grant execute on function public.chat_begin_upload(uuid, text, text, bigint) to authenticated;

notify pgrst, 'reload schema';
