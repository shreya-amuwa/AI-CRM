import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseExistingCustomers, type Cell } from '../../shared/existingCustomerImport.js';
import type { SheetSyncConnectResult, SheetSyncConnection, SheetSyncResult, SheetSyncRowStatus } from '../../shared/contracts.js';
import { sheetSyncSchema } from '../../shared/validation.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { unwrap } from '../repositories/base.js';
import { CustomerImportService } from './CustomerImportService.js';

/**
 * Google Sheet sync of existing customers (docs/CUSTOMER_SHEET_SYNC.md, migration 20270219000100).
 *
 * A person who may import customers connects their team's Google Sheet: the CRM makes a secret key (shown once, inside the Apps Script),
 * keeps only its SHA-256 hash, and "CRM Sync > Sync now" in the sheet sends the rows that changed. The sheet is read with the SAME parser as
 * the Excel upload (shared/existingCustomerImport) and saved by the database AS that person (sheet_sync_apply), so nothing a sheet sends can
 * do more than that person could do by uploading the file. Client passwords are never taken from a sheet.
 */
const KEY_PREFIX = 'crmss_';
const KEY_PATTERN = /^crmss_[A-Za-z0-9_-]{43}$/;

export const sheetSyncKeyHash = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

/** The key the sheet sends ("Authorization: Bearer crmss_..."), checked for its shape before the database is asked. */
export function sheetSyncKeyFrom(header: string | undefined): string {
  const key = (header ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!KEY_PATTERN.test(key)) throw new AppError('UNAUTHENTICATED', 'This sync key is not valid. Copy the script again from the CRM: Import Customers > Google Sheet sync.');
  return key;
}

/** The sheet as the parser expects it: the heading rows where they are, every sent row at its own sheet row number. */
export function sheetFromSync(input: { header: Cell[][]; rows: { r: number; c: Cell[] }[]; sheetName?: string }) {
  const rows: Cell[][] = input.header.map(r => r.slice());
  for (const { r, c } of input.rows) {
    if (r - 1 < input.header.length) continue; // a heading row is never data
    rows[r - 1] = c;
  }
  return { sheets: [{ name: input.sheetName || 'Import', rows }] };
}

const RANK: Record<SheetSyncRowStatus, number> = { ERROR: 5, DUPLICATE: 4, SKIPPED: 3, UPDATED: 2, ADDED: 1, SAVED: 0 };

export class SheetSyncService {
  constructor(private readonly db: SupabaseClient) {}

  async connection(): Promise<SheetSyncConnection | null> {
    return unwrap(await this.db.rpc('sheet_sync_connection_get')) as SheetSyncConnection | null;
  }

  /** Connects the sheet, or replaces the key (the old script stops working at once). The key is returned once and never stored. */
  async connect(): Promise<SheetSyncConnectResult> {
    const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const connection = unwrap(await this.db.rpc('sheet_sync_connection_create', { p_key_hash: sheetSyncKeyHash(key), p_key_hint: key.slice(-4) })) as SheetSyncConnection;
    return { connection, key };
  }

  async disconnect(): Promise<{ revoked: boolean }> {
    return unwrap(await this.db.rpc('sheet_sync_connection_revoke')) as { revoked: boolean };
  }
}

/** One "Sync now" from the sheet (no CRM login: the key names the connection, the database acts as its owner). */
export async function runSheetSync(authorization: string | undefined, body: unknown, origin?: string): Promise<SheetSyncResult> {
  const keyHash = sheetSyncKeyHash(sheetSyncKeyFrom(authorization));
  const input = parse(sheetSyncSchema, body);
  if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'The Google Sheet sync is not set up on the server.');
  const parsed = parseExistingCustomers(sheetFromSync(input));
  if (parsed.format === 'tabs') {
    throw new AppError('VALIDATION_ERROR', 'This sheet is not the one-sheet customer template: its headings were not found. Use the "Existing Customers - one sheet" template (or the Add Customer upload template).');
  }
  const status = new Map<number, { status: SheetSyncRowStatus; message: string }>();
  const mark = (row: number, s: SheetSyncRowStatus, message: string) => {
    const was = status.get(row);
    if (!was || RANK[s] > RANK[was.status]) status.set(row, { status: s, message });
  };
  for (const p of parsed.problems) mark(p.row, 'ERROR', p.message);
  // a sheet never sets a client's password: the client chooses it from the e-mailed link
  const data = { ...parsed.data, customers: parsed.data.customers?.map(({ loginPassword: _drop, ...rest }) => rest) };
  const problemRows = new Set(parsed.problems.map(p => p.row));
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as { row: number }[]).filter(r => !problemRows.has(r.row))]));

  const db = getServiceClient();
  const res = unwrap(await db.rpc('sheet_sync_apply', { p_key_hash: keyHash, p_data: clean })) as {
    results: { row: number; status: SheetSyncRowStatus; message: string }[];
    summary: SheetSyncResult['summary'];
    ownerId: string;
    newLogins: { customerId: string; email: string; name: string; businessName?: string; row?: number }[];
  };
  for (const r of res.results ?? []) mark(r.row, r.status, r.message);

  // client logins for the customers the sheet added: created now, recorded as the person who connected the sheet, "Set your password" e-mail
  const logins: SheetSyncResult['logins'] = [];
  if (res.newLogins?.length) {
    const importer = new CustomerImportService(db);
    for (const l of res.newLogins) {
      const out = await importer.createLogin({ id: res.ownerId }, l, origin, undefined,
        async (customerId, userId, email) => unwrap(await db.rpc('sheet_sync_record_login', { p_key_hash: keyHash, p_customer: customerId, p_user_id: userId, p_email: email })));
      logins.push({ row: l.row, email: l.email, created: out.login === 'CREATED', mail: out.mail, detail: out.detail });
      if (l.row && out.login !== 'CREATED') {
        const was = status.get(l.row);
        if (was) status.set(l.row, { status: was.status, message: `${was.message} The client login was not created: ${out.detail ?? 'try again from the customer page.'}` });
      }
    }
  }
  const results = [...status.entries()].sort((a, b) => a[0] - b[0]).map(([row, v]) => ({ row, ...v }));
  const parserErrors = parsed.problems.length;
  return {
    results,
    summary: { ...res.summary, rejected: (res.summary?.rejected ?? 0) + parserErrors, outcome: parserErrors && res.summary?.outcome === 'OK' ? 'PARTIAL' : res.summary?.outcome },
    logins
  };
}
