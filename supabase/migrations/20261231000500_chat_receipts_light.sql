-- =============================================================================
-- Chat under load: "delivered" and "seen" no longer rewrite the conversation row. Run after 20261231000400_part_payment_invoice_suffix.sql. Safe to run again.
--
-- WHY. With ~200 people signed in, every message made each receiving screen report "delivered" (chat_ack_delivered) and, in a direct chat,
-- "seen" (chat_mark_read). Each report also UPDATEd the conversation row only so that the sender's screen would notice. Every UPDATE of
-- chat_conversations goes out through Supabase Realtime, which checks the row against every subscriber's permissions, and every screen that
-- receives it reloads its chat list and unread counts. One group message therefore became hundreds of row updates (all on the SAME row,
-- waiting on each other's lock), thousands of Realtime permission checks and a burst of API requests: the database ran out of time and
-- requests failed after 30 seconds (Vercel "Task timed out"), including unrelated ones (notifications).
--
-- WHAT CHANGES (behaviour of the ticks is the same):
--   * chat_ack_delivered and chat_mark_read write only the person's own read state (chat_read_state) and nothing when it does not move.
--   * The screen that reported tells the sender's open conversation through a Realtime broadcast (no database work); the sender's screen
--     then asks for the ticks (chat_message_receipts, unchanged). The ticks are also refreshed on new messages and when the tab is opened.
--   * Client chats keep their client_read_seq / staff_read_seq columns (they only move forward, at most once per read).
-- =============================================================================

create or replace function public.chat_ack_delivered(p_conversation uuid, p_seq bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  v_seq bigint;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or private.chat_access(p_conversation) is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  v_seq := least(greatest(coalesce(p_seq, 0), 0), c.last_seq);
  -- only forward, and only the caller's own row (no write at all when nothing moves; the conversation row is never touched)
  insert into public.chat_read_state (conversation_id, user_id, last_delivered_seq) values (c.id, auth.uid(), v_seq)
  on conflict (conversation_id, user_id) do update
    set last_delivered_seq = greatest(public.chat_read_state.last_delivered_seq, excluded.last_delivered_seq)
  where public.chat_read_state.last_delivered_seq < excluded.last_delivered_seq;
  return jsonb_build_object('deliveredSeq', v_seq);
end $$;
revoke all on function public.chat_ack_delivered(uuid, bigint) from public, anon;
grant execute on function public.chat_ack_delivered(uuid, bigint) to authenticated;

create or replace function public.chat_mark_read(p_conversation uuid, p_seq bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  a text;
  me uuid := auth.uid();
  v_seq bigint;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  v_seq := least(greatest(coalesce(p_seq, c.last_seq), 0), c.last_seq);
  -- only forward (no write when nothing moves); a direct chat's "seen" no longer touches the conversation row (see the header)
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq) values (c.id, me, v_seq)
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now()
  where public.chat_read_state.last_read_seq < excluded.last_read_seq;
  if c.kind = 'CLIENT' and a = 'CLIENT' then
    update public.chat_conversations set client_read_seq = v_seq where id = c.id and client_read_seq < v_seq;
    update public.client_notifications set read_at = now() where customer_id = c.customer_id and entity_type = 'chat' and entity_id = c.id and read_at is null;
  elsif c.kind = 'CLIENT' and a = 'STAFF' then
    update public.chat_conversations set staff_read_seq = v_seq where id = c.id and staff_read_seq < v_seq;
  end if;
  if a <> 'CLIENT' then
    update public.notifications set read_at = now() where recipient_id = me and entity_type = 'chat' and entity_id = c.id and read_at is null;
  end if;
  return jsonb_build_object('readSeq', (select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = me));
end $$;
revoke all on function public.chat_mark_read(uuid, bigint) from public, anon;
grant execute on function public.chat_mark_read(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
