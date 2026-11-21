import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { CrocodialClient, CrocodialError, crocodialToken, safeNextUrl, type ClientOptions, type CrocodialResource } from './client.js';
import { credentialCheck, credentialProblem, reportRuntime, runtimeInfo } from './runtime.js';
import { testCrocodialConnection } from './directory.js';

/**
 * The read-only Crocodial sync (migration 20270115000200, docs/CROCODIAL_INTEGRATION.md). Runs with the automation dispatch and on the
 * Super Admin's "Sync now", for connections that are switched on AND serve a switched-on, rolled-out department (the database decides).
 *
 * Per connection: the user list is refreshed (so new Crocodial users show up for mapping), then leads, follow-ups, remarks and call logs,
 * each on its own: one failing does not stop or move the others. Per resource the database hands out a lease and says what to fetch (a
 * resumed pull, a full pull, or rows updated since the checkpoint); every page is stored as it arrives, so a pull that runs out of time
 * resumes from the next page on the next run. The checkpoint moves only after a resource was read to the end.
 *
 * Only the fields the CRM needs are kept: no e-mail, budget, deal value, custom fields, raw numbers, SIM, location or recording.
 */
// the small lists first, the call log (by far the largest) last: a first read that takes several runs never holds the others back
export const SYNC_RESOURCES = ['leads', 'followups', 'remarks', 'call-logs'] as const;
export type SyncResource = (typeof SYNC_RESOURCES)[number];

const ref = z.object({ id: z.number().int().positive() }).passthrough().nullable().optional();
const str = z.string().nullable().optional();
const leadSchema = z.object({
  id: z.number().int().positive(), name: str, phone_number: str, company: str, city: str, status: str, source: str,
  assigned_to: ref, created_by: ref, called: z.boolean().nullable().optional(), dialer_outcome: str, remark_count: z.number().int().nullable().optional(),
  next_followup_at: str, last_interaction_at: str, created_at: str, updated_at: str
}).passthrough();
const callSchema = z.object({
  id: z.number().int().positive(), phone_number: str, contact_name: str, call_type: str, call_at: str,
  duration_seconds: z.number().int().nullable().optional(), connected: z.boolean().nullable().optional(), called_by: ref, lead: ref, synced_at: str
}).passthrough();
const followupSchema = z.object({
  id: z.number().int().positive(), lead: ref, phone_number: str, note: str, scheduled_at: str, done: z.boolean().nullable().optional(),
  completed_at: str, created_by: ref, created_at: str, updated_at: str
}).passthrough();
const remarkSchema = z.object({
  id: z.number().int().positive(), lead: ref, phone_number: str, remark: str, written_by: ref, created_at: str, updated_at: str
}).passthrough();

/** Crocodial's row -> what the database stores (the person a record belongs to is only ever its Crocodial user id). */
export const TO_STORE: Record<SyncResource, { schema: z.ZodTypeAny; map: (r: any) => Record<string, unknown> }> = {
  leads: {
    schema: leadSchema,
    map: r => ({ id: r.id, name: r.name ?? null, phone: r.phone_number ?? null, company: r.company ?? null, city: r.city ?? null, status: r.status ?? null,
      source: r.source ?? null, assignedTo: r.assigned_to?.id ?? null, createdBy: r.created_by?.id ?? null, called: r.called ?? null,
      dialerOutcome: r.dialer_outcome ?? null, remarkCount: r.remark_count ?? null, nextFollowupAt: r.next_followup_at ?? null,
      lastInteractionAt: r.last_interaction_at ?? null, createdAt: r.created_at ?? null, updatedAt: r.updated_at ?? null })
  },
  'call-logs': {
    schema: callSchema,
    map: r => ({ id: r.id, calledBy: r.called_by?.id ?? null, lead: r.lead?.id ?? null, phone: r.phone_number ?? null, contactName: r.contact_name ?? null,
      callType: r.call_type ?? null, callAt: r.call_at ?? null, durationSeconds: r.duration_seconds ?? 0, connected: r.connected ?? null, syncedAt: r.synced_at ?? null })
  },
  followups: {
    schema: followupSchema,
    map: r => ({ id: r.id, createdBy: r.created_by?.id ?? null, lead: r.lead?.id ?? null, phone: r.phone_number ?? null, note: r.note ?? null,
      scheduledAt: r.scheduled_at ?? null, done: r.done ?? null, completedAt: r.completed_at ?? null, createdAt: r.created_at ?? null, updatedAt: r.updated_at ?? null })
  },
  remarks: {
    schema: remarkSchema,
    map: r => ({ id: r.id, writtenBy: r.written_by?.id ?? null, lead: r.lead?.id ?? null, phone: r.phone_number ?? null, remark: r.remark ?? null,
      createdAt: r.created_at ?? null, updatedAt: r.updated_at ?? null })
  }
};

/** updated_since in the form the guide shows (an ISO date-time with an offset). */
export const sinceParam = (iso: string | null | undefined): string | undefined => (iso ? new Date(iso).toISOString().replace(/\.\d{3}Z$/, '+00:00') : undefined);

export interface ResourceSummary { resource: SyncResource; outcome: 'DONE' | 'PARTIAL' | 'FAILED' | 'SKIPPED'; pages: number; rows: number; skipped: number; error?: string }
export interface ConnectionSummary { connectionId: string; health: string; resources: ResourceSummary[]; error?: string }
export interface CrocodialSyncSummary { connections: ConnectionSummary[]; requests: number; note?: string }

type Begin = { ok: boolean; reason?: string; full?: boolean; since?: string | null; page?: number };

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** One resource of one connection: begin (lease), pages until done or out of time, finish. Never throws for Crocodial's errors. */
async function syncResource(db: SupabaseClient, client: CrocodialClient, connectionId: string, resource: SyncResource, deadline: number): Promise<ResourceSummary> {
  const b = await rpc<Begin>(db, 'croc_sync_begin', { p_connection: connectionId, p_resource: resource });
  if (!b.ok) return { resource, outcome: 'SKIPPED', pages: 0, rows: 0, skipped: 0, error: b.reason };
  const { schema, map } = TO_STORE[resource];
  let url: string | null = client.url(resource as CrocodialResource, { per_page: 500, updated_since: b.full ? undefined : sinceParam(b.since), page: b.page ?? 1 });
  let pages = 0;
  let rows = 0;
  let skipped = 0;
  try {
    while (url) {
      if (Date.now() > deadline) {
        await rpc(db, 'croc_sync_finish', { p_connection: connectionId, p_resource: resource, p_outcome: 'PARTIAL', p_pages: pages, p_skipped: skipped });
        return { resource, outcome: 'PARTIAL', pages, rows, skipped };
      }
      const p = await client.page(url);
      pages += 1;
      const good: Record<string, unknown>[] = [];
      for (const r of p.rows) {
        const v = schema.safeParse(r);
        if (v.success) good.push(map(v.data));
        else skipped += 1;
      }
      const next = safeNextUrl(url, p.meta.next_page_url);
      const nextPage = next ? Number(new URL(next).searchParams.get('page')) : null;
      rows += await rpc<number>(db, 'croc_sync_store', { p_connection: connectionId, p_resource: resource, p_rows: good, p_next_page: nextPage });
      url = next;
    }
    await rpc(db, 'croc_sync_finish', { p_connection: connectionId, p_resource: resource, p_outcome: 'DONE', p_pages: pages, p_skipped: skipped });
    return { resource, outcome: 'DONE', pages, rows, skipped };
  } catch (err) {
    const message = err instanceof CrocodialError ? err.message : 'The sync of this resource failed.';
    await rpc(db, 'croc_sync_finish', { p_connection: connectionId, p_resource: resource, p_outcome: 'FAILED', p_pages: pages, p_skipped: skipped, p_error: message })
      .catch(() => undefined);
    if (err instanceof CrocodialError && (err.health === 'AUTH_FAILED' || err.health === 'DISABLED_AT_SOURCE')) throw err;
    return { resource, outcome: 'FAILED', pages, rows, skipped, error: message };
  }
}

/**
 * Sync the connections that are due (or one connection, for "Sync now"). Stops starting new pages at the time budget; a pull in
 * progress resumes next run. Never throws.
 */
export async function runCrocodialSync(
  opts: ClientOptions & { db?: SupabaseClient; connectionId?: string; budgetMs?: number; env?: NodeJS.ProcessEnv; context?: 'SYNC' | 'REFRESH' } = {}
): Promise<CrocodialSyncSummary> {
  const out: CrocodialSyncSummary = { connections: [], requests: 0 };
  if (!opts.db && !hasServiceClient()) return { ...out, note: 'The server has no service key.' };
  const db = opts.db ?? getServiceClient();
  const deadline = Date.now() + (opts.budgetMs ?? 15_000);
  let due: { id: string; credentialRef: string }[];
  try {
    due = await rpc(db, 'croc_sync_due', { p_connection: opts.connectionId ?? null });
  } catch (err) {
    return { ...out, note: (err as Error).message.slice(0, 200) };
  }
  for (const c of due ?? []) {
    if (Date.now() > deadline) break;
    const summary: ConnectionSummary = { connectionId: c.id, health: 'OK', resources: [] };
    out.connections.push(summary);
    const token = crocodialToken(c.credentialRef, opts.env);
    if (!token) {
      // A server without the token never marks a connection broken while another server (for example the Cloudflare Worker, when an
      // old Vercel deployment still receives the scheduled call) has a valid one: it leaves the read to that server.
      const rt = runtimeInfo(opts.env);
      const check = credentialCheck(c.credentialRef, opts.env);
      const seen = await reportRuntime(db, c.id, rt, check, opts.context ?? 'SYNC');
      summary.health = 'NO_CREDENTIAL';
      if (seen.otherHasCredential) {
        summary.error = 'Skipped: this server has no token; another server that has it reads this connection.';
        continue;
      }
      summary.error = credentialProblem(c.credentialRef, check, rt);
      await db.rpc('croc_connection_status', { p_connection: c.id, p_health: 'NO_CREDENTIAL', p_error: summary.error });
      continue;
    }
    // the account's users first: a new Crocodial user appears for mapping, a removed one is marked missing
    const dir = await testCrocodialConnection(c, { ...opts, db, context: opts.context ?? 'SYNC' });
    out.requests += dir.requests;
    if (!dir.ok) {
      summary.health = dir.health;
      summary.error = dir.message;
      continue;
    }
    const client = new CrocodialClient(token, opts);
    try {
      for (const r of SYNC_RESOURCES) summary.resources.push(await syncResource(db, client, c.id, r, deadline));
      const failed = summary.resources.find(r => r.outcome === 'FAILED');
      summary.health = failed ? 'ERROR' : 'OK';
      await db.rpc('croc_connection_status', { p_connection: c.id, p_health: failed ? 'ERROR' : 'OK', p_error: failed ? `${failed.resource}: ${failed.error}` : null });
    } catch (err) {
      const e = err as CrocodialError;
      summary.health = e.health;
      summary.error = e.message;
      await db.rpc('croc_connection_status', { p_connection: c.id, p_health: e.health, p_error: e.message });
    }
    out.requests += client.requests;
  }
  return out;
}

/** With the automation dispatch: a short, best-effort run. */
export async function crocodialSyncQuietly(budgetMs = 15_000): Promise<CrocodialSyncSummary | { error: string }> {
  return runCrocodialSync({ budgetMs }).catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
}
