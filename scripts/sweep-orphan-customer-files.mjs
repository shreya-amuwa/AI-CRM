#!/usr/bin/env node
/**
 * Removes the uploaded files (Supabase Storage bucket "customer-documents" AND, when the R2_* variables are set,
 * Cloudflare R2) of customers that no longer exist.
 * Run it after supabase/maintenance/delete_dummy_customers.sql, which deletes the database rows but
 * cannot delete the files themselves.
 *
 * Files live at customers/<customer id>/<folder>/<file>.pdf. A customer folder whose id is no longer
 * in the customers table is orphaned; files of customers that still exist are never touched.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sweep-orphan-customer-files.mjs          (list only)
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sweep-orphan-customer-files.mjs --apply  (delete)
 *
 * For Cloudflare R2 also set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac } from 'node:crypto';
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


// ---------------------------------------------------------------------------------------------
// Cloudflare R2 (S3 API, presigned requests; same signing as server/storage/sigv4.ts)
// ---------------------------------------------------------------------------------------------
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();

export function r2Config(env = process.env) {
  const accountId = (env.R2_ACCOUNT_ID || '').trim();
  const endpoint = (env.R2_ENDPOINT || '').trim();
  const accessKeyId = (env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (env.R2_BUCKET || '').trim();
  if ((!accountId && !endpoint) || !accessKeyId || !secretAccessKey || !bucket) return null;
  const u = endpoint ? new URL(endpoint) : new URL(`https://${accountId}.r2.cloudflarestorage.com`);
  return { host: u.host, protocol: u.protocol.replace(':', ''), bucket, accessKeyId, secretAccessKey };
}

export function r2Url(cfg, method, key, query = {}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const q = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`, 'X-Amz-Date': amzDate, 'X-Amz-Expires': '300', 'X-Amz-SignedHeaders': 'host' };
  const cq = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const path = `/${cfg.bucket}${key ? '/' + key : ''}`.split('/').map(enc).join('/');
  const canonical = [method, path, cq, `host:${cfg.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const signing = hmac(hmac(hmac(hmac('AWS4' + cfg.secretAccessKey, day), 'auto'), 's3'), 'aws4_request');
  return `${cfg.protocol}://${cfg.host}${path}?${cq}&X-Amz-Signature=${createHmac('sha256', signing).update(sts).digest('hex')}`;
}

/** Every object key under a prefix. */
export async function r2List(cfg, prefix) {
  const keys = [];
  let token;
  do {
    const res = await fetch(r2Url(cfg, 'GET', '', { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) }));
    if (!res.ok) throw new Error(`Could not list R2 "${prefix}": HTTP ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml) || [])[1] : undefined;
  } while (token);
  return keys;
}

/** @returns {Promise<{ files: string[], removed: number }>} files of customers that no longer exist, in R2 */
export async function sweepR2(supabase, cfg, { apply = false } = {}) {
  const prefix = `${BUCKET}/${ROOT}/`;
  const keys = await r2List(cfg, prefix);
  const byCustomer = new Map();
  for (const k of keys) {
    const id = k.slice(prefix.length).split('/')[0];
    if (UUID.test(id)) byCustomer.set(id, [...(byCustomer.get(id) ?? []), k]);
  }
  const ids = [...byCustomer.keys()];
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('customers').select('id').in('id', ids.slice(i, i + 100));
    if (error) throw new Error(`Could not read customers: ${error.message}`);
    for (const r of data ?? []) existing.add(r.id);
  }
  const files = ids.filter(id => !existing.has(id)).flatMap(id => byCustomer.get(id));
  let removed = 0;
  if (apply) {
    for (const key of files) {
      const res = await fetch(r2Url(cfg, 'DELETE', key), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`Could not remove ${key}: HTTP ${res.status}`);
      removed++;
    }
  }
  return { files, removed };
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
  const cfg = r2Config();
  const r2 = cfg ? await sweepR2(supabase, cfg, { apply }) : null;
  console.log(`Customer folders in Storage: ${r.folders}`);
  console.log(`Folders of customers that no longer exist: ${r.orphanFolders.length} (${r.files.length} files)`);
  if (r2) console.log(`Cloudflare R2: ${r2.files.length} files of customers that no longer exist`);
  const all = [...r.files, ...(r2?.files ?? [])];
  if (!apply) {
    for (const f of all.slice(0, 50)) console.log(`  would remove ${f}`);
    if (all.length > 50) console.log(`  ... and ${all.length - 50} more`);
    console.log(all.length ? 'Nothing was deleted. Run again with --apply to delete these files.' : 'Nothing to remove.');
  } else {
    console.log(`Removed ${r.removed + (r2?.removed ?? 0)} files.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
