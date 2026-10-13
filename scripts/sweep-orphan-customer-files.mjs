#!/usr/bin/env node
/**
 * Removes the uploaded files (Storage bucket "customer-documents") of customers that no longer exist.
 * Run it after supabase/maintenance/delete_dummy_customers.sql, which deletes the database rows but
 * cannot delete the files themselves.
 *
 * Files live at customers/<customer id>/<folder>/<file>.pdf. A customer folder whose id is no longer
 * in the customers table is orphaned; files of customers that still exist are never touched.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sweep-orphan-customer-files.mjs          (list only)
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sweep-orphan-customer-files.mjs --apply  (delete)
 */
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

const BUCKET = 'customer-documents';
const ROOT = 'customers';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every object path under a folder (folders have no id in the Storage listing). */
async function listFiles(storage, folder) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.list(folder, { limit: 100, offset });
    if (error) throw new Error(`Could not list "${folder}": ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const path = `${folder}/${item.name}`;
      if (item.id) out.push(path);
      else out.push(...(await listFiles(storage, path)));
    }
    if (data.length < 100) break;
  }
  return out;
}

/** The customer folders under customers/ (their names are customer ids). */
async function listCustomerFolders(storage) {
  const ids = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.list(ROOT, { limit: 100, offset });
    if (error) throw new Error(`Could not list "${ROOT}": ${error.message}`);
    if (!data?.length) break;
    ids.push(...data.filter(d => !d.id && UUID.test(d.name)).map(d => d.name));
    if (data.length < 100) break;
  }
  return ids;
}

/** @returns {Promise<{ folders: number, orphanFolders: string[], files: string[], removed: number }>} */
export async function sweep(supabase, { apply = false } = {}) {
  const storage = supabase.storage.from(BUCKET);
  const folders = await listCustomerFolders(storage);
  const existing = new Set();
  for (let i = 0; i < folders.length; i += 100) {
    const chunk = folders.slice(i, i + 100);
    const { data, error } = await supabase.from('customers').select('id').in('id', chunk);
    if (error) throw new Error(`Could not read customers: ${error.message}`);
    for (const r of data ?? []) existing.add(r.id);
  }
  const orphanFolders = folders.filter(id => !existing.has(id));
  const files = [];
  for (const id of orphanFolders) files.push(...(await listFiles(storage, `${ROOT}/${id}`)));
  let removed = 0;
  if (apply) {
    for (let i = 0; i < files.length; i += 100) {
      const batch = files.slice(i, i + 100);
      const { error } = await storage.remove(batch);
      if (error) throw new Error(`Could not remove files: ${error.message}`);
      removed += batch.length;
    }
  }
  return { folders: folders.length, orphanFolders, files, removed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/sweep-orphan-customer-files.mjs [--apply]');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await sweep(supabase, { apply });
  console.log(`Customer folders in Storage: ${r.folders}`);
  console.log(`Folders of customers that no longer exist: ${r.orphanFolders.length} (${r.files.length} files)`);
  if (!apply) {
    for (const f of r.files.slice(0, 50)) console.log(`  would remove ${f}`);
    if (r.files.length > 50) console.log(`  ... and ${r.files.length - 50} more`);
    console.log(r.files.length ? 'Nothing was deleted. Run again with --apply to delete these files.' : 'Nothing to remove.');
  } else {
    console.log(`Removed ${r.removed} files.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
