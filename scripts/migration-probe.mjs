#!/usr/bin/env node
/**
 * Which migrations might NOT be applied to a database? Reads supabase/migrations/*.sql and prints ONE read-only SQL statement. Paste it into the
 * Supabase SQL editor of the project you want to check: it lists every table, function and added column that the migrations create (and no later
 * migration drops) but that does not exist there, with the migration file that creates it. No rows = everything the migrations create is present.
 *
 *   node scripts/migration-probe.mjs > probe.sql            (all migrations)
 *   node scripts/migration-probe.mjs --since=20261220 > probe.sql   (only migrations from that date on: a shorter statement)
 *
 * Best effort, and honest about it: it finds migrations that were never run (their new objects are missing). It cannot see a migration that was run
 * only in part, or one that changes an existing function / policy without adding anything. It only READS the catalog; it changes nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../supabase/migrations/', import.meta.url).pathname;
const since = (process.argv.find((a) => a.startsWith('--since=')) || '').split('=')[1] || '';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const objs = new Map(); // key -> {kind, schema, name, extra, file}
const strip = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const id = '"?([a-z_][a-z0-9_]*)"?';
for (const f of files) {
  const sql = strip(readFileSync(join(dir, f), 'utf8')).toLowerCase();
  const add = (kind, schema, name, extra = '') => objs.set(`${kind}|${schema}|${name}|${extra}`, { kind, schema, name, extra, file: f });
  const del = (kind, schema, name, extra = '') => objs.delete(`${kind}|${schema}|${name}|${extra}`);
  for (const m of sql.matchAll(new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(public|private)\\.${id}`, 'g'))) add('table', m[1], m[2]);
  for (const m of sql.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(public|private)\\.${id}\\s*\\(`, 'g'))) add('function', m[1], m[2]);
  for (const m of sql.matchAll(new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(public)\\.${id}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${id}`, 'g'))) add('column', m[1], m[2], m[3]);
  for (const m of sql.matchAll(new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(public)\\.${id}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${id}[^;]*?(?:,\\s*add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${id})`, 'g'))) add('column', m[1], m[2], m[4]);
  for (const m of sql.matchAll(new RegExp(`drop\\s+table\\s+(?:if\\s+exists\\s+)?(public|private)\\.${id}`, 'g'))) { del('table', m[1], m[2]); for (const k of [...objs.keys()]) if (k.startsWith(`column|${m[1]}|${m[2]}|`)) objs.delete(k); }
  for (const m of sql.matchAll(new RegExp(`drop\\s+function\\s+(?:if\\s+exists\\s+)?(public|private)\\.${id}`, 'g'))) del('function', m[1], m[2]);
  for (const m of sql.matchAll(new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(public)\\.${id}\\s+drop\\s+column\\s+(?:if\\s+exists\\s+)?${id}`, 'g'))) del('column', m[1], m[2], m[3]);
  for (const m of sql.matchAll(new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(public)\\.${id}\\s+rename\\s+to\\s+${id}`, 'g'))) { del('table', m[1], m[2]); add('table', m[1], m[3]); }
}

const rows = [...objs.values()].filter((o) => !since || o.file >= since);
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const values = rows.map((o) => `(${q(o.kind)},${q(o.schema)},${q(o.name)},${q(o.extra)},${q(o.file)})`).join(',\n  ');
console.log(`-- Read-only. Generated from ${files.length} migrations (${rows.length} objects${since ? `, from ${since}` : ''}) by scripts/migration-probe.mjs.
-- No rows returned = every object the migrations create is present in this database.
with expected(kind, schema_name, name, extra, migration) as (values
  ${values}
)
select e.migration, e.kind, e.schema_name || '.' || e.name || case when e.extra <> '' then '.' || e.extra else '' end as missing_object
from expected e
where not case e.kind
  when 'table' then to_regclass(e.schema_name || '.' || e.name) is not null
  when 'function' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = e.schema_name and p.proname = e.name)
  when 'column' then exists (select 1 from information_schema.columns c where c.table_schema = e.schema_name and c.table_name = e.name and c.column_name = e.extra)
end
order by e.migration, e.kind, 3;`);
console.error(`${files.length} migrations, ${rows.length} objects to check${since ? ` (from ${since})` : ''}.`);
