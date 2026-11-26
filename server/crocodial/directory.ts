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
  connection: { id: string; credentialRef: string },
  opts: ClientOptions & { db?: SupabaseClient; env?: NodeJS.ProcessEnv; host?: string | null; context?: 'TEST' | 'SYNC' | 'REFRESH' } = {}
): Promise<CrocodialTestResult> {
  const db = opts.db ?? getServiceClient();
  const status = (health: CrocodialHealth, error: string | null) =>
    db.rpc('croc_connection_status', { p_connection: connection.id, p_health: health, p_error: error });
  const token = crocodialToken(connection.credentialRef, opts.env);
  if (!token) {
    // the message names THIS server (Cloudflare / Vercel, environment): a deployment without the setting says so, never "the server"
    const rt = runtimeInfo(opts.env, opts.host);
    const check = credentialCheck(connection.credentialRef, opts.env);
    const message = `${credentialProblem(connection.credentialRef, check, rt)} The token is never typed into the CRM.`;
    await reportRuntime(db, connection.id, rt, check, opts.context ?? 'TEST');
    await status('NO_CREDENTIAL', message);
    return { ok: false, health: 'NO_CREDENTIAL', message, employees: 0, branches: 0, timezone: null, requests: 0 };
  }
  await reportRuntime(db, connection.id, runtimeInfo(opts.env, opts.host), credentialCheck(connection.credentialRef, opts.env), opts.context ?? 'TEST');
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
