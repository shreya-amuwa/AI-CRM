-- =============================================================================
-- READ-ONLY database usage report for the Amuwa AI CRM (sizes, indexes, growth, cache, realtime plumbing).
-- Run it in the Supabase SQL editor, one numbered block at a time. It only SELECTs: it changes nothing, and it returns sizes and
-- counts only (no customer data). Paste the RESULTS (not the queries) back to whoever is sizing costs.
-- Statistics blocks (3, 4, 7) are since the last statistics reset: run them after the system has been in normal use for a few weeks.
-- =============================================================================

-- 1. Database size against the plan's included disk (Supabase Pro includes 8 GB per project)
select pg_size_pretty(pg_database_size(current_database())) as database_size,
       round(pg_database_size(current_database()) / 1073741824.0, 2) as gb;

-- 2. The 30 largest tables: table (heap), indexes and TOAST (large values such as big JSON / text) separately, with the row estimate
select c.relname as "table",
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_relation_size(c.oid)) as heap,
       pg_size_pretty(pg_indexes_size(c.oid)) as indexes,
       pg_size_pretty(coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0)), 0)) as toast,
       c.reltuples::bigint as rows_estimate,
       round(100.0 * pg_indexes_size(c.oid) / nullif(pg_total_relation_size(c.oid), 0)) as index_pct
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
 order by pg_total_relation_size(c.oid) desc
 limit 30;

-- 3. Indexes never used since the statistics were last reset (candidates to review - NOT to drop blindly: unique / primary / foreign-key
--    support and rarely-run reports also show 0 scans). Largest first.
select s.relname as "table", s.indexrelname as "index", pg_size_pretty(pg_relation_size(s.indexrelid)) as size, s.idx_scan as scans
  from pg_stat_user_indexes s
  join pg_index i on i.indexrelid = s.indexrelid
 where s.schemaname = 'public' and s.idx_scan = 0 and not i.indisunique and not i.indisprimary
 order by pg_relation_size(s.indexrelid) desc
 limit 40;

-- 4. Exact duplicate indexes (same table, columns and condition)
select indrelid::regclass as "table", string_agg(indexrelid::regclass::text, ', ') as duplicate_indexes,
       pg_size_pretty(sum(pg_relation_size(indexrelid))) as size_together
  from pg_index
 group by indrelid, indkey::text, indclass::text, coalesce(pg_get_expr(indpred, indrelid), ''), coalesce(pg_get_expr(indexprs, indrelid), '')
having count(*) > 1;

-- 5. Large JSON values: average and maximum stored size of each JSON column (sizes only; 2,000-row sample per column)
select x.json_column, x.sampled, x.avg_bytes, x.max_bytes
  from (select c.table_name || '.' || c.column_name as json_column,
               (xpath('/row/n/text()', r.x))[1]::text::bigint as sampled,
               (xpath('/row/a/text()', r.x))[1]::text::numeric as avg_bytes,
               (xpath('/row/m/text()', r.x))[1]::text::bigint as max_bytes
          from information_schema.columns c
         cross join lateral (select query_to_xml(format('select count(*) n, round(avg(pg_column_size(%2$I))) a, max(pg_column_size(%2$I)) m from (select %2$I from public.%1$I where %2$I is not null limit 2000) s', c.table_name, c.column_name), false, true, '') as x) r
         where c.table_schema = 'public' and c.data_type = 'jsonb') x
 where x.sampled > 0
 order by x.avg_bytes * x.sampled desc
 limit 20;

-- 6. Dead rows and vacuum health (bloat shows up as dead rows that stay)
select relname as "table", n_live_tup as live, n_dead_tup as dead, last_autovacuum
  from pg_stat_user_tables where schemaname = 'public' order by n_dead_tup desc limit 15;

-- 7. Cache hit ratio (below ~99 % on a small database means the compute size is too small for the working set)
select round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) as table_cache_hit_pct from pg_statio_user_tables;
select round(100.0 * sum(idx_blks_hit) / nullif(sum(idx_blks_hit) + sum(idx_blks_read), 0), 2) as index_cache_hit_pct from pg_statio_user_indexes;

-- 8. Growth: rows added per day over the last 30 days in the tables that grow without bound (counts only)
select 'audit_logs' as "table", date_trunc('day', created_at)::date as day, count(*) from public.audit_logs where created_at > now() - interval '30 days' group by 2
union all select 'notifications', date_trunc('day', created_at)::date, count(*) from public.notifications where created_at > now() - interval '30 days' group by 2
union all select 'chat_messages', date_trunc('day', created_at)::date, count(*) from public.chat_messages where created_at > now() - interval '30 days' group by 2
union all select 'customer_activities', date_trunc('day', created_at)::date, count(*) from public.customer_activities where created_at > now() - interval '30 days' group by 2
union all select 'automation_jobs', date_trunc('day', created_at)::date, count(*) from public.automation_jobs where created_at > now() - interval '30 days' group by 2
union all select 'support_ticket_updates', date_trunc('day', created_at)::date, count(*) from public.support_ticket_updates where created_at > now() - interval '30 days' group by 2
order by 1, 2;

-- 9. Documents: metadata rows only (the files live in Cloudflare R2 / Storage); size recorded per storage provider
select coalesce(storage_provider, 'unknown') as provider, count(*) as documents, pg_size_pretty(coalesce(sum(size_bytes), 0)) as recorded_file_size,
       count(*) filter (where deleted_at is not null) as soft_deleted
  from public.customer_documents group by 1;

-- 10. Realtime plumbing: tables published, replication slots and how far behind they are, and open connections by application
select count(*) as published_tables from pg_publication_tables where pubname = 'supabase_realtime';
select slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as wal_retained from pg_replication_slots;
select coalesce(nullif(application_name, ''), '(none)') as application, state, count(*) from pg_stat_activity where datname = current_database() group by 1, 2 order by 3 desc;

-- 11. Hot rows written on every API request (rate limiting) and the tables that must never be purged
select count(*) as rate_limit_rows from private.rate_limit_counters;
select pg_size_pretty(pg_total_relation_size('public.audit_logs')) as audit_logs_size, (select count(*) from public.audit_logs) as audit_rows;

-- 12. (Optional, needs the pg_stat_statements extension: Supabase > Database > Extensions) the statements that cost the most time.
--     The text is normalised (values replaced by $1, $2): still, do not paste any text that contains names or numbers.
-- select calls, round(total_exec_time::numeric / 1000, 1) as total_seconds, round(mean_exec_time::numeric, 1) as mean_ms, rows, left(query, 140) as query
--   from pg_stat_statements order by total_exec_time desc limit 25;
