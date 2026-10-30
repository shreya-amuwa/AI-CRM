-- =============================================================================
-- ONE-TIME: delete the direct chat between a Team Lead and a Sales Department Head. Nothing else.
--
-- Run it in the Supabase SQL editor. SAFE BY DEFAULT: with the confirmation left empty it only SHOWS the matching
-- conversation(s). It deletes only when exactly one conversation matches AND you paste its id into `confirm`.
-- Take a backup first (Database > Backups); this cannot be undone.
--
-- Matches: DIRECT conversations (never groups or client chats) whose two members are one Team Lead (TEAM_HEAD) and one Sales
-- Department Head (DEPARTMENT_HEAD, side SALES). Optionally narrow it with the two e-mails below.
-- Deleted: the conversation with its messages, file records, read marks, "deleted for me" marks and members (they all belong to it),
-- and the files stored in Supabase Storage. Files kept on Cloudflare R2 are NOT removed by SQL: the preview lists their paths
-- (use scripts/delete-team-lead-sales-head-chat.mjs, which also removes R2 files, if the chat had attachments stored there).
-- =============================================================================
drop table if exists pg_temp.s;
create temp table s as select
  ''::text as confirm,         -- paste the conversation id from the preview here to really delete
  ''::text as team_lead_email, -- optional, narrows the match
  ''::text as sales_head_email; -- optional, narrows the match

-- preview
select c.id as conversation_id, tl.full_name as team_lead, tl.email as team_lead_email, sh.full_name as sales_head, sh.email as sales_head_email,
       (select count(*) from public.chat_messages m where m.conversation_id = c.id) as messages,
       (select count(*) from public.chat_attachments a where a.conversation_id = c.id) as files,
       (select string_agg(a.storage_provider || ':' || a.storage_bucket || '/' || a.storage_path, E'\n') from public.chat_attachments a where a.conversation_id = c.id) as file_paths,
       c.created_at, c.last_message_at
  from public.chat_conversations c
  join public.chat_members m1 on m1.conversation_id = c.id
  join public.chat_members m2 on m2.conversation_id = c.id and m2.profile_id <> m1.profile_id
  join public.profiles tl on tl.id = m1.profile_id and tl.role = 'TEAM_HEAD'
  join public.profiles sh on sh.id = m2.profile_id and sh.role = 'DEPARTMENT_HEAD' and sh.head_division = 'SALES'
 where c.kind = 'DIRECT'
   and (select count(*) from public.chat_members x where x.conversation_id = c.id) = 2
   and (select team_lead_email from s) in ('', tl.email) and (select sales_head_email from s) in ('', sh.email);

-- delete (only when the confirmation equals the id of the single matching conversation)
do $$
declare
  v_confirm text := (select confirm from pg_temp.s);
  v_ids uuid[];
begin
  select array_agg(c.id) into v_ids
    from public.chat_conversations c
    join public.chat_members m1 on m1.conversation_id = c.id
    join public.chat_members m2 on m2.conversation_id = c.id and m2.profile_id <> m1.profile_id
    join public.profiles tl on tl.id = m1.profile_id and tl.role = 'TEAM_HEAD'
    join public.profiles sh on sh.id = m2.profile_id and sh.role = 'DEPARTMENT_HEAD' and sh.head_division = 'SALES'
   where c.kind = 'DIRECT'
     and (select count(*) from public.chat_members x where x.conversation_id = c.id) = 2
     and (select team_lead_email from pg_temp.s) in ('', tl.email) and (select sales_head_email from pg_temp.s) in ('', sh.email);
  if v_confirm = '' then
    raise notice 'Preview only: % matching conversation(s). Paste the conversation id into confirm to delete.', coalesce(array_length(v_ids, 1), 0);
    return;
  end if;
  if coalesce(array_length(v_ids, 1), 0) <> 1 or v_ids[1]::text <> v_confirm then
    raise exception 'Nothing deleted: exactly one conversation must match and confirm must be its id (matches: %).', coalesce(array_length(v_ids, 1), 0);
  end if;
  if to_regclass('storage.objects') is not null then
    delete from storage.objects o using public.chat_attachments a
     where a.conversation_id = v_ids[1] and a.storage_provider is distinct from 'R2' and o.bucket_id = a.storage_bucket and o.name = a.storage_path;
  end if;
  delete from public.chat_conversations where id = v_ids[1] and kind = 'DIRECT';
  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (null, 'CHAT_CONVERSATION_PURGED', 'chat_conversation', jsonb_build_object('conversation_id', v_ids[1], 'one_time_cleanup', true));
  raise notice 'Deleted conversation % (messages, files and members included).', v_ids[1];
end $$;
