-- =============================================================================
-- Chat push notifications: a new chat message reaches the other people in the conversation on their phones and laptops (Web Push,
-- the same devices as the attendance reminders, 20270109000200).
--
-- * Who: private.chat_recipients (the existing rule: members of direct and group chats; the client chat's assigned staff and support
--   group), active staff only, never the sender, only people who could see the message (from_seq), with their chat switch on and a device.
-- * What: colleague chats (DIRECT, GROUP) show the name and the text (cut to 120 characters); client chats show only the company and
--   "New message from <sender>" - client conversations are business records and must not appear on a lock screen. A file without text
--   says "sent a file"; an end-to-end encrypted message says "New message". System lines are never pushed.
-- * Once: chat_push_log records each message, so a retried call pushes nothing twice.
-- * At most 40 devices per message (the Worker's request limit), recipients in name order, newest devices first.
--
-- The API calls chat_push_for_message right after a message is sent (service role only). Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The person's chat switch (default on), next to their reminder settings
-- ---------------------------------------------------------------------------
alter table public.attendance_reminder_prefs add column if not exists chat_push boolean not null default true;

create or replace function private.attendance_reminder_settings_json(p_profile uuid, p_is_staff boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'company', jsonb_build_object('enabled', s.reminders_enabled, 'punchIn', private.hhmm(s.reminder_punch_in), 'lunch', private.hhmm(s.reminder_lunch),
                                  'punchOut', private.hhmm(s.reminder_punch_out), 'followUpMinutes', s.reminder_follow_up_minutes,
                                  'lunchWarningMinutes', s.reminder_lunch_warning_minutes, 'days', to_jsonb(s.reminder_days)),
    'mine', case when p_is_staff then jsonb_build_object('enabled', coalesce(p.enabled, true), 'punchIn', private.hhmm(p.punch_in),
                                                         'lunch', private.hhmm(p.lunch), 'punchOut', private.hhmm(p.punch_out)) else 'null'::jsonb end,
    'effective', case when p_is_staff then (select jsonb_build_object('enabled', t.enabled, 'punchIn', private.hhmm(t.punch_in), 'lunch', private.hhmm(t.lunch),
                                                                      'punchOut', private.hhmm(t.punch_out)) from private.reminder_times(p_profile) t)
                      else 'null'::jsonb end,
    'pausedToday', coalesce(s.reminders_paused_on = private.office_today(), false),
    'canManage', private.is_hr_staff(),
    'chatPush', coalesce(p.chat_push, true))
  from public.attendance_settings s
  left join public.attendance_reminder_prefs p on p.profile_id = p_profile
  where s.id
$$;
revoke all on function private.attendance_reminder_settings_json(uuid, boolean) from public, anon, authenticated;

-- "Chat notifications" on / off for the signed-in person (any active staff account, the Super Admin included). Audited.
create or replace function public.push_chat_set(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'VALIDATION_ERROR: Choose on or off.' using errcode = 'P0001';
  end if;
  insert into public.attendance_reminder_prefs (profile_id, chat_push, updated_at) values (me.id, p_enabled, now())
  on conflict (profile_id) do update set chat_push = excluded.chat_push, updated_at = now();
  perform private.write_audit('CHAT_PUSH_UPDATED', 'attendance_reminder_prefs', null, me.department_id, me.team_id, jsonb_build_object('enabled', p_enabled));
  return private.attendance_reminder_settings_json(me.id, me.role <> 'SUPER_ADMIN');
end $$;
revoke all on function public.push_chat_set(boolean) from public, anon;
grant execute on function public.push_chat_set(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who is notified of a message, and what it says
-- ---------------------------------------------------------------------------
create table if not exists public.chat_push_log (
  message_id uuid primary key references public.chat_messages (id) on delete cascade,
  pushed_at timestamptz not null default now()
);
alter table public.chat_push_log enable row level security;
revoke all on public.chat_push_log from public, anon, authenticated;

create or replace function public.chat_push_for_message(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.chat_messages;
  c public.chat_conversations;
  v_sender text;
  v_text text;
  v_title text;
  v_body text;
  v_url text;
  v_budget integer := 40;   -- devices per message
  v_out jsonb := '[]'::jsonb;
  v_targets jsonb;
  r record;
begin
  select * into m from public.chat_messages where id = p_message;
  if m.id is null or m.kind = 'SYSTEM' or m.sender_kind = 'SYSTEM' or m.deleted_at is not null then
    return '[]'::jsonb;
  end if;
  insert into public.chat_push_log (message_id) values (m.id) on conflict do nothing;
  if not found then
    return '[]'::jsonb;   -- already pushed
  end if;
  select * into c from public.chat_conversations where id = m.conversation_id;
  v_sender := coalesce(nullif(btrim(m.sender_name), ''), 'Someone');
  v_text := case
    when m.encrypted then 'New message'
    when btrim(m.body) = '' and jsonb_array_length(m.attachments) > 0 then 'sent a file'
    when btrim(m.body) = '' then 'New message'
    when length(m.body) > 120 then left(m.body, 120) || '…'
    else m.body end;
  if c.kind = 'CLIENT' then
    select coalesce(nullif(btrim(cu.company), ''), cu.name) into v_title from public.customers cu where cu.id = c.customer_id;
    v_title := coalesce(v_title, 'Client chat');
    v_body := format('New message from %s', v_sender);
    v_url := '/?open=chat&client=' || c.id;
  else
    v_title := case when c.kind = 'GROUP' then v_sender || ' · ' || coalesce(nullif(btrim(c.title), ''), 'Group') else v_sender end;
    v_body := v_text;
    v_url := '/?open=chat&conversation=' || c.id;
  end if;

  for r in
    select distinct on (p.full_name, p.id) p.id
      from private.chat_recipients(c.id) rc
      join public.profiles p on p.id = rc.user_id and p.status = 'ACTIVE'
      left join public.attendance_reminder_prefs pr on pr.profile_id = p.id
     where p.id is distinct from m.sender_id and rc.from_seq < m.seq and coalesce(pr.chat_push, true)
     order by p.full_name, p.id
  loop
    exit when v_budget <= 0;
    select coalesce(jsonb_agg(x.t order by x.created desc), '[]'::jsonb) into v_targets
      from (select jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth) as t, s.created_at as created
              from public.push_subscriptions s where s.profile_id = r.id and s.active order by s.created_at desc limit v_budget) x (t, created);
    continue when jsonb_array_length(v_targets) = 0;
    v_budget := v_budget - jsonb_array_length(v_targets);
    v_out := v_out || jsonb_build_object('profileId', r.id, 'title', v_title, 'body', v_body, 'tag', 'chat-' || c.id, 'url', v_url, 'targets', v_targets);
  end loop;
  return v_out;
end $$;
revoke all on function public.chat_push_for_message(uuid) from public, anon, authenticated;
grant execute on function public.chat_push_for_message(uuid) to service_role;
