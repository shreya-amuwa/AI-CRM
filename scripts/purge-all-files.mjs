#!/usr/bin/env node
/**
 * FRESH START, part 2: deletes EVERY uploaded file - Supabase Storage (all buckets; the buckets themselves stay) and Cloudflare R2
 * (everything the CRM stored: customer documents, invoices, ticket attachments, telecaller sheets, business-associate files).
 * Run it together with supabase/maintenance/reset_all_data_keep_super_admin.sql (which deletes the database rows).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… [R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=…] \
 *     node scripts/purge-all-files.mjs                                       list only (deletes nothing)
 *   … node scripts/purge-all-files.mjs --apply --confirm "DELETE ALL FILES"  delete
 *
 * R2: only keys under the CRM's own folders (one per storage bucket name, e.g. customer-documents/…) are removed. Anything else in
 * the R2 bucket is listed as "left alone"; add --r2-everything to remove those too (only if the R2 bucket is used by the CRM alone).
 * This cannot be undone. Keep the service role key and R2 keys secret: do not paste them into chat or commit them.
 */
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { r2Config, r2Url, r2List } from './sweep-orphan-customer-files.mjs';

const CONFIRM = 'DELETE ALL FILES';
const KNOWN_FOLDERS = ['customer-documents', 'telecaller-sheets', 'ba-documents', 'blueprint-files', 'amuwa-docs'];

/** Every file path in a bucket (folders have no id in the Storage listing). */
async function listAll(storage, folder = '') {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.list(folder, { limit: 100, offset });
    if (error) throw new Error(`Could not list "${folder || '/'}": ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const path = folder ? `${folder}/${item.name}` : item.name;
      if (item.id) out.push(path);
      else out.push(...(await listAll(storage, path)));
    }
    if (data.length < 100) break;
  }
  return out;
}

export async function purge({ supabase, r2, apply = false, r2Everything = false }) {
  const report = { buckets: [], r2: null };
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Could not list buckets: ${error.message}`);
  for (const b of buckets ?? []) {
    const storage = supabase.storage.from(b.id);
    const files = await listAll(storage);
    let removed = 0;
    if (apply) {
      for (let i = 0; i < files.length; i += 100) {
        const batch = files.slice(i, i + 100);
        const { error: e } = await storage.remove(batch);
        if (e) throw new Error(`Could not remove files from ${b.id}: ${e.message}`);
        removed += batch.length;
      }
    }
    report.buckets.push({ bucket: b.id, files: files.length, removed });
  }
  if (r2) {
    const keys = await r2List(r2, '');
    const folders = new Set([...KNOWN_FOLDERS, ...(buckets ?? []).map(b => b.id)]);
    const mine = keys.filter(k => folders.has(k.split('/')[0]));
    const others = keys.filter(k => !folders.has(k.split('/')[0]));
    const doomed = r2Everything ? keys : mine;
    let removed = 0;
    if (apply) {
      for (const key of doomed) {
        const res = await fetch(r2Url(r2, 'DELETE', key), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error(`Could not remove ${key}: HTTP ${res.status}`);
        removed++;
      }
    }
    report.r2 = { files: doomed.length, removed, leftAlone: r2Everything ? [] : others };
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const r2Everything = args.includes('--r2-everything');
  const confirm = args.includes('--confirm') ? args[args.indexOf('--confirm') + 1] : '';
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… [R2_*=…] node scripts/purge-all-files.mjs [--apply --confirm "DELETE ALL FILES"] [--r2-everything]');
    process.exit(1);
  }
  if (apply && confirm !== CONFIRM) {
    console.error(`Nothing was deleted. To delete, add:  --apply --confirm "${CONFIRM}"`);
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const r2 = r2Config();
  const r = await purge({ supabase, r2, apply, r2Everything });
  for (const b of r.buckets) console.log(`Supabase Storage "${b.bucket}": ${b.files} files${apply ? `, removed ${b.removed}` : ''}`);
  if (r.r2) {
    console.log(`Cloudflare R2: ${r.r2.files} files${apply ? `, removed ${r.r2.removed}` : ''}`);
    if (r.r2.leftAlone.length) console.log(`Cloudflare R2: ${r.r2.leftAlone.length} other file(s) left alone (not CRM folders), e.g. ${r.r2.leftAlone.slice(0, 3).join(', ')} - add --r2-everything to remove them too`);
  } else {
    console.log('Cloudflare R2: not configured here (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET to clear it as well).');
  }
  if (!apply) console.log('Nothing was deleted. Run again with  --apply --confirm "DELETE ALL FILES"  to delete.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
