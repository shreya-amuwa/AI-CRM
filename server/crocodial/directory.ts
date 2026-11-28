import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '../db/supabase.js';
import {
  CrocodialClient, CrocodialError, crocodialBranchSchema, crocodialEmployeeSchema, crocodialToken, type ClientOptions, type CrocodialHealth
} from './client.js';
import { credentialCheck, credentialProblem, reportRuntime, runtimeInfo } from './runtime.js';

export interface CrocodialTestResult {
  ok: boolean;
  health: CrocodialHealth;
  message: string;
  employees: number;
  branches: number;
  timezone: string | null;
  requests: number;
}

/**
 * "Test connection" (Super Admin): reads the account's employee and branch lists (nothing else), keeps them so the Super Admin can choose
 * the Crocodial user of each person, and records the connection's health. Names, active flags and branch ids are kept; phone numbers and
 * e-mails Crocodial returns are dropped here. The caller has already been checked by the database (croc_admin_connection).
 */
export async function testCrocodialConnection(
  connection: { id: string; credentialRef: string | null },
  opts: ClientOptions & {
    db?: SupabaseClient; env?: NodeJS.ProcessEnv; host?: string | null; context?: 'TEST' | 'SYNC' | 'REFRESH';
    /** the key to use instead of the server setting: a stored key (opened by the server) or a candidate key being checked */
    token?: string;
    /** a candidate key: one read of 1 user and nothing else (nothing stored, the connection's health untouched); employees = the account's users */
    probe?: boolean;
  } = {}
): Promise<CrocodialTestResult> {
  if (opts.probe) return probeKey(opts.token ?? '', opts);
  const db = opts.db ?? getServiceClient();
  const status = (health: CrocodialHealth, error: string | null) =>
    db.rpc('croc_connection_status', { p_connection: connection.id, p_health: health, p_error: error });
  const token = opts.token ?? crocodialToken(connection.credentialRef, opts.env);
  if (!token && !connection.credentialRef) {
    const message = 'No Crocodial key has been entered for this connection yet.';
    await status('NO_CREDENTIAL', message);
    return { ok: false, health: 'NO_CREDENTIAL', message, employees: 0, branches: 0, timezone: null, requests: 0 };
  }
  if (!token) {
    // the message names THIS server (Cloudflare / Vercel, environment): a deployment without the setting says so, never "the server"
    const rt = runtimeInfo(opts.env, opts.host);
    const check = credentialCheck(connection.credentialRef, opts.env);
    const message = `${credentialProblem(connection.credentialRef ?? '', check, rt)} The token is never typed into the CRM.`;
    await reportRuntime(db, connection.id, rt, check, opts.context ?? 'TEST');
    await status('NO_CREDENTIAL', message);
    return { ok: false, health: 'NO_CREDENTIAL', message, employees: 0, branches: 0, timezone: null, requests: 0 };
  }
  // (a stored key is not a setting of this server: nothing to report about the setting)
  if (!opts.token) await reportRuntime(db, connection.id, runtimeInfo(opts.env, opts.host), credentialCheck(connection.credentialRef, opts.env), opts.context ?? 'TEST');
  const client = new CrocodialClient(token, opts);
  try {
    const emp = await client.all('employees', crocodialEmployeeSchema, {}, 20);
    const br = await client.all('branches', crocodialBranchSchema, {}, 20);
    const stored = await db.rpc('croc_store_directory', {
      p_connection: connection.id,
      p_employees: emp.rows.map(e => ({ id: e.id, name: (e.name ?? '').trim(), isActive: e.is_active ?? null, branchIds: (e.branches ?? []).map(b => b.id), updatedAt: e.updated_at ?? null })),
      p_branches: br.rows.map(b => ({ id: b.id, name: (b.branch_name ?? '').trim(), status: b.status ?? null })),
      p_timezone: emp.timezone
    });
    if (stored.error) throw new CrocodialError('ERROR', 'The employee list could not be saved.');
    await status('OK', null);
    return {
      ok: true, health: 'OK', message: `Connected. ${emp.rows.length} employees and ${br.rows.length} branches read.`,
      employees: emp.rows.length, branches: br.rows.length, timezone: emp.timezone, requests: client.requests
    };
  } catch (err) {
    const e = err instanceof CrocodialError ? err : new CrocodialError('ERROR', 'The connection test failed.');
    await status(e.health, e.message);
    return { ok: false, health: e.health, message: e.message, employees: 0, branches: 0, timezone: null, requests: client.requests };
  }
}

/** One read of 1 user with a candidate key. Never throws; nothing is stored or recorded. */
async function probeKey(token: string, opts: ClientOptions): Promise<CrocodialTestResult> {
  const client = new CrocodialClient(token, opts);
  try {
    const p = await client.page(client.url('employees', { per_page: 1, page: 1 }));
    const users = p.meta.total ?? p.rows.length;
    return { ok: true, health: 'OK', message: 'Crocodial accepted the key.', employees: users, branches: 0, timezone: p.meta.timezone ?? null, requests: client.requests };
  } catch (err) {
    const e = err instanceof CrocodialError ? err : new CrocodialError('ERROR', 'The key could not be checked.');
    return { ok: false, health: e.health, message: e.message, employees: 0, branches: 0, timezone: null, requests: client.requests };
  }
}
