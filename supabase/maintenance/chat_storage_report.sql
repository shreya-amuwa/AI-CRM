-- =============================================================================
-- READ-ONLY chat storage and Realtime report for the Amuwa AI CRM. Run it in the Supabase SQL editor, one numbered block at a time.
-- It only SELECTs: it changes nothing and it returns sizes and counts only - NEVER a message body, a file name, a key or a person's name.
-- Paste the RESULTS back to whoever sizes the plan. The general report (all tables) is usage_report.sql in this folder.
-- =============================================================================

-- 1. Database size, and the chat tables' share of it (heap + indexes + TOAST, as stored on disk - not the text length)
select pg_size_pretty(pg_database_size(current_database())) as database_size,
       pg_database_size(current_database()) as database_bytes,
       (select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'chat\_%') as chat_tables_total,
       round(100.0 * (select sum(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'chat\_%') / greatest(pg_database_size(current_database()), 1), 2) as chat_percent;

-- 2. Each chat table: rows (estimate), table, indexes, TOAST (large values such as encrypted envelopes) and total
select c.relname as table_name, c.reltuples::bigint as rows_estimate,
       pg_size_pretty(pg_relation_size(c.oid)) as heap,
       pg_size_pretty(pg_indexes_size(c.oid)) as indexes,
       pg_size_pretty(coalesce(pg_total_relation_size(c.reltoastrelid), 0)) as toast,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_total_relation_size(c.oid) as total_bytes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'chat\_%'
 order by pg_total_relation_size(c.oid) desc;

-- 3. Messages: how many, of which kind, and the real stored size per row (pg_column_size, not the text length)
select count(*) as messages,
       count(*) filter (where kind = 'TEXT' and not encrypted and deleted_at is null) as readable,
       count(*) filter (where encrypted and deleted_at is null) as encrypted_legacy,
       count(*) filter (where deleted_at is not null) as deleted_tombstones,
       count(*) filter (where kind <> 'TEXT') as system_events,
       round(avg(pg_column_size(m.*))) as avg_row_bytes,
       round(avg(pg_column_size(m.e2ee)) filter (where m.e2ee is not null)) as avg_envelope_bytes,
       max(pg_column_size(m.*)) as max_row_bytes
  from public.chat_messages m;

-- 4. Conversations and people in them
select kind, count(*) as conversations,
       (select count(*) from public.chat_members mm join public.chat_conversations cc on cc.id = mm.conversation_id where cc.kind = c.kind and mm.left_at is null) as active_members
  from public.chat_conversations c group by kind order by kind;
select count(*) as read_marks, pg_size_pretty(pg_total_relation_size('public.chat_read_state')) as read_marks_size from public.chat_read_state;
select count(*) as hidden_for_me_marks from public.chat_message_hidden;

-- 5. Files: metadata rows in the database; the files themselves are in Cloudflare R2 (or Supabase Storage as the fallback) - sizes per provider
select coalesce(storage_provider, 'unknown') as provider, status, count(*) as files,
       pg_size_pretty(sum(size_bytes)) as stored_size, sum(size_bytes) as stored_bytes,
       count(*) filter (where mime_type = 'application/x-amuwa-e2ee') as encrypted_files
  from public.chat_attachments group by 1, 2 order by 1, 2;
-- files of deleted messages whose stored object was not removed yet (the API retries the removal; nothing to do by hand)
select count(*) as deleted_files_not_removed_yet from public.chat_attachments where status = 'DELETED' and storage_removed_at is null;

-- 6. Growth: messages per day over the last 30 days, and the average day
select date_trunc('day', created_at)::date as day, count(*) as messages
  from public.chat_messages where created_at > now() - interval '30 days' group by 1 order by 1;
with daily as (select count(*)::numeric / 30 as per_day from public.chat_messages where created_at > now() - interval '30 days'),
     width as (select coalesce(avg(pg_column_size(m.*)), 400)::numeric as row_bytes from public.chat_messages m where created_at > now() - interval '30 days'),
     idx as (select coalesce(pg_indexes_size('public.chat_messages')::numeric / nullif((select count(*) from public.chat_messages), 0), 120) as idx_bytes)
select round(daily.per_day, 1) as messages_per_day,
       pg_size_pretty((daily.per_day * 30 * (width.row_bytes + idx.idx_bytes))::bigint) as growth_per_month,
       pg_size_pretty((daily.per_day * 30 * (width.row_bytes + idx.idx_bytes))::bigint) as in_30_days,
       pg_size_pretty((daily.per_day * 90 * (width.row_bytes + idx.idx_bytes))::bigint) as in_90_days,
       pg_size_pretty((daily.per_day * 180 * (width.row_bytes + idx.idx_bytes))::bigint) as in_180_days
  from daily, width, idx;

-- 7. Capacity left against the plan's database allowance. Replace 500 MB by your plan's value (Free: 500 MB; Pro: 8 GB included).
select pg_size_pretty(pg_database_size(current_database())) as used,
       pg_size_pretty(greatest(500::bigint * 1024 * 1024 - pg_database_size(current_database()), 0)) as left_on_free_plan,
       round(100.0 * pg_database_size(current_database()) / (500::bigint * 1024 * 1024), 1) as percent_of_free_plan;

-- 8. Realtime: which chat tables are published (each change is checked against RLS for every subscriber), and connections now
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'chat\_%' order by 1;
select coalesce(application_name, '') as application, count(*) as connections from pg_stat_activity group by 1 order by 2 desc;

-- 9. Indexes on the chat tables (an exact duplicate costs space and write time)
select t.relname as table_name, i.relname as index_name, pg_size_pretty(pg_relation_size(i.oid)) as size, x.idx_scan as scans_since_reset
  from pg_index ix join pg_class i on i.oid = ix.indexrelid join pg_class t on t.oid = ix.indrelid
  left join pg_stat_user_indexes x on x.indexrelid = i.oid
 where t.relname like 'chat\_%' order by pg_relation_size(i.oid) desc;

-- 10. The internal chat mode (20261224000200) and when it was last changed
select internal_mode, updated_at from public.chat_settings;
