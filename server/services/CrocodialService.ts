import type {
  CrocodialHealthReport, CrocodialRefreshCapabilities, CrocodialRefreshRequest, CrocodialRuntimeReport, CrocodialAdminOverview, CrocodialConnection, CrocodialMapping, CrocodialMappingCheck, CrocodialMyStatus, CrocodialSyncRunResult, CrocodialSyncStatus, CrocodialTestResult, CrocodialActivity, CrocodialLeads, CrocodialTeamActivity, CrocodialReconcileOverview, CrocodialLeadLinkList, CrocodialLeadActivity, CrocodialReconcileRun, CrocodialTeamLeads
} from '../../shared/contracts.js';
import {
  crocodialActivityQuerySchema, crocodialConnectionSaveSchema, crocodialCountFromSchema, crocodialLeadsQuerySchema, crocodialTeamActivityQuerySchema, crocodialDepartmentLinkSchema, crocodialMappingSchema, crocodialRevokeSchema, crocodialRolloutSchema, crocodialRefreshSchema, uuidSchema,
  crocodialLeadImportSchema, crocodialStatusMappingSchema, crocodialLinksQuerySchema, crocodialLinkResolveSchema, crocodialTeamLeadsQuerySchema
} from '../../shared/validation.js';
import { crocodialToken } from '../crocodial/client.js';
import { credentialCheck, reportRuntime, runtimeInfo } from '../crocodial/runtime.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { testCrocodialConnection } from '../crocodial/directory.js';
import { reconcileLeads, runCrocodialSync } from '../crocodial/sync.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { CrocodialRepository } from '../repositories/CrocodialRepository.js';

/**
 * The Crocodial integration's configuration (Super Admin) and an employee's own switch. Every rule (who may configure, the rollout, who can
 * be mapped, who sees what) is enforced by the database; this layer validates the input, tells the Super Admin whether the server has the
 * token setting a connection names (a yes / no, never the value), and runs "Test connection" after the database has checked the caller.
 */
export class CrocodialService {
  // env: only tests pass one; the server reads its own settings (process.env, then the Worker's bindings: server/crocodial/runtime.ts)
  constructor(private readonly repo: CrocodialRepository, private readonly env?: NodeJS.ProcessEnv) {}

  private withCredential(c: CrocodialConnection): CrocodialConnection {
    return { ...c, credentialConfigured: crocodialToken(c.credentialRef, this.env) !== null };
  }

  async overview(): Promise<CrocodialAdminOverview> {
    const o = await this.repo.overview();
    return { ...o, connections: o.connections.map(c => this.withCredential(c)) };
  }
  async rolloutSet(body: unknown): Promise<CrocodialAdminOverview> {
    const b = parse(crocodialRolloutSchema, body);
    await this.repo.rolloutSet(b.departmentId, b.division, b.allowed, b.note ?? null);
    return this.overview();
  }
  async connectionSave(body: unknown): Promise<CrocodialConnection> {
    const b = parse(crocodialConnectionSaveSchema, body);
    return this.withCredential(await this.repo.connectionSave({ ...b, externalAccountLabel: b.externalAccountLabel ?? null }));
  }
  async testConnection(id: string, host?: string | null): Promise<CrocodialTestResult> {
    // the database checks the caller is the Super Admin and returns the setting's NAME; the server reads the token from its own environment
    const c = await this.repo.connection(parse(uuidSchema, id));
    return testCrocodialConnection({ id: c.id, credentialRef: c.credentialRef }, { env: this.env, host }) as Promise<CrocodialTestResult>;
  }
  departmentLinkSave(body: unknown) {
    const b = parse(crocodialDepartmentLinkSchema, body);
    return this.repo.departmentLinkSave(b.connectionId, b.departmentId, b.division, b.enabled, b.stage);
  }
  mappingCheck(body: unknown): Promise<CrocodialMappingCheck> {
    const b = parse(crocodialMappingSchema, body);
    return this.repo.mappingCheck(b.connectionId, b.externalEmployeeId, b.profileId, b.departmentId);
  }
  mappingCreate(body: unknown): Promise<CrocodialMapping> {
    const b = parse(crocodialMappingSchema, body);
    return this.repo.mappingCreate(b.connectionId, b.externalEmployeeId, b.profileId, b.departmentId);
  }
  mappingApprove(id: string): Promise<CrocodialMapping> { return this.repo.mappingApprove(parse(uuidSchema, id)); }
  /** Count a mapping's activity from a date (null: from the first stored activity of that Crocodial user). Super Admin only, audited. */
  mappingCountFrom(id: string, body: unknown): Promise<CrocodialMapping> {
    return this.repo.mappingCountFrom(parse(uuidSchema, id), parse(crocodialCountFromSchema, body ?? {}).from ?? null);
  }
  mappingRevoke(id: string, body: unknown): Promise<CrocodialMapping> {
    return this.repo.mappingRevoke(parse(uuidSchema, id), parse(crocodialRevokeSchema, body ?? {}).reason ?? null);
  }
  myStatus(): Promise<CrocodialMyStatus> { return this.repo.myStatus(); }

  /** Which refresh buttons the signed-in person has (decided by the database from their role, scopes and approved mappings). */
  refreshCapabilities(): Promise<CrocodialRefreshCapabilities> { return this.repo.refreshCapabilities(); }

  /**
   * "Refresh": the database checks the scope against the signed-in account, coalesces with any read already running or asked for, and
   * names the connections this request started. Those are read after the answer is sent (one account-level read per connection, whoever
   * asked); the answer itself never carries connection or Crocodial user details. The scheduled run picks up anything not finished.
   */
  async refresh(body: unknown): Promise<{ data: CrocodialRefreshRequest; after?: () => Promise<unknown> }> {
    const b = parse(crocodialRefreshSchema, body ?? {});
    const { kick, ...request } = await this.repo.refreshRequest(b.scope, b.departmentId ?? null);
    const ids = Array.isArray(kick) ? kick : [];
    if (!ids.length) return { data: request };
    const env = this.env;
    return {
      data: request,
      after: async () => {
        // the Worker reads after the answer (waitUntil); elsewhere the answer waits for this, so only a short first slice runs there
        const deadline = Date.now() + (runtimeInfo(env).platform === 'cloudflare' ? 25_000 : 8_000);
        for (const connectionId of ids) {
          const left = deadline - Date.now();
          if (left < 3_000) break; // the scheduled run continues (croc_sync_due includes a pending refresh)
          await runCrocodialSync({ connectionId, budgetMs: left, env, context: 'REFRESH' }).catch(() => undefined);
        }
      }
    };
  }
  refreshStatus(id: string): Promise<CrocodialRefreshRequest> { return this.repo.refreshStatus(parse(uuidSchema, id)); }

  /**
   * Super Admin: each connection's health, with what EVERY server reported about its token and this server's live check. This server's
   * check is recorded too, so the page shows which deployment has the setting and which does not. Never a token value.
   */
  async connectionHealth(host?: string | null): Promise<CrocodialHealthReport> {
    const rows = await this.repo.connectionHealth();
    const rt = runtimeInfo(this.env, host);
    const db = hasServiceClient() ? getServiceClient() : null;
    const connections = await Promise.all(rows.map(async h => {
      const check = credentialCheck(h.connection.credentialRef, this.env);
      if (db) await reportRuntime(db, h.connection.id, rt, check, 'PAGE');
      const mine: CrocodialRuntimeReport = {
        runtime: rt.runtime, platform: rt.platform, environment: rt.environment, deployment: rt.deployment, host: rt.host,
        credentialDetected: check.detected, credentialFormatValid: check.formatValid, context: 'PAGE', reportedAt: new Date().toISOString()
      };
      return {
        ...h,
        connection: this.withCredential(h.connection),
        runtimes: [mine, ...(h.runtimes ?? []).filter(r => r.runtime !== rt.runtime)],
        current: { nameValid: check.nameValid, credentialDetected: check.detected, credentialFormatValid: check.formatValid }
      };
    }));
    return { server: { runtime: rt.runtime, platform: rt.platform, environment: rt.environment, deployment: rt.deployment, host: rt.host }, connections };
  }
  syncStatus(): Promise<CrocodialSyncStatus[]> { return this.repo.syncStatus(); }
  /** The connected people the caller may see (their own people, their department's Sales, or everyone for the Super Admin). */
  teamActivity(query: unknown): Promise<CrocodialTeamActivity> {
    const q = parse(crocodialTeamActivityQuerySchema, query ?? {});
    return this.repo.teamActivity(q.from ?? null, q.to ?? null, q.departmentId ?? null, q.teamId ?? null);
  }
  /** One person's Crocodial leads: the caller's own, or (profileId) someone the database lets the caller see. */
  leads(query: unknown): Promise<CrocodialLeads> {
    const q = parse(crocodialLeadsQuerySchema, query ?? {});
    return this.repo.leads(q.profileId ?? null, q.search || null, q.filter ?? 'ALL', q.page ?? 1, q.pageSize ?? 25);
  }
  /** One person's activity: the caller's own, or (profileId) someone the database lets the caller see. */
  activity(query: unknown): Promise<CrocodialActivity> {
    const q = parse(crocodialActivityQuerySchema, query ?? {});
    return this.repo.activity(q.profileId ?? null, q.from ?? null, q.to ?? null);
  }
  /** "Sync now": the database checks the caller and the limit first; the run stops starting pages after 50 s (enough for a first read of
   * about 40 pages; Sync now has no page cap) and does the weekly full re-read when it is due. Anything left continues with the next
   * scheduled run (hourly by default). */
  // ---- the CRM lead pipeline (20270304000100); the database checks the Super Admin on every call
  reconcileOverview(id: string): Promise<CrocodialReconcileOverview> { return this.repo.reconcileOverview(parse(uuidSchema, id)); }
  leadLinks(id: string, query: unknown): Promise<CrocodialLeadLinkList> {
    const q = parse(crocodialLinksQuerySchema, query ?? {});
    return this.repo.leadLinks(parse(uuidSchema, id), q.status ?? null, q.page, q.pageSize);
  }
  leadLinkResolve(id: string, body: unknown) {
    const b = parse(crocodialLinkResolveSchema, body ?? {});
    return this.repo.leadLinkResolve(parse(uuidSchema, id), b.action, b.customerId ?? null);
  }
  leadImportSet(id: string, body: unknown) {
    const b = parse(crocodialLeadImportSchema, body ?? {});
    return this.repo.leadImportSet(parse(uuidSchema, id), b.departmentId, b.mode);
  }
  statusMappingSet(id: string, body: unknown) {
    const b = parse(crocodialStatusMappingSchema, body ?? {});
    // the old body (a disposition) is translated by the database with the migration's table
    if (b.disposition !== undefined) return this.repo.statusMappingSet(parse(uuidSchema, id), b.status, b.disposition);
    return this.repo.statusMappingTagSet(parse(uuidSchema, id), b.status, b.tagId ?? null, b.ignore ?? false);
  }
  /** "Reconcile now": the Super Admin check is the overview call (as the signed-in user); the batches run with the service key. */
  async reconcileNow(id: string): Promise<CrocodialReconcileRun> {
    const connectionId = parse(uuidSchema, id);
    await this.repo.reconcileOverview(connectionId);
    if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'The server has no service key.');
    return reconcileLeads(getServiceClient(), connectionId, Date.now() + 25_000);
  }
  /** Managers' lead ownership figures (the database limits them to the people the caller may see). */
  teamLeads(query: unknown): Promise<CrocodialTeamLeads> {
    const q = parse(crocodialTeamLeadsQuerySchema, query ?? {});
    return this.repo.teamLeads(q.departmentId ?? null, q.teamId ?? null);
  }
  /** The lead page's Crocodial activity (whoever may see the lead). */
  leadActivity(customerId: string): Promise<CrocodialLeadActivity> { return this.repo.leadActivity(parse(uuidSchema, customerId)); }

  async syncNow(id: string): Promise<CrocodialSyncRunResult> {
    const c = await this.repo.syncRequest(parse(uuidSchema, id));
    const r = await runCrocodialSync({ connectionId: c.id, budgetMs: 50_000, env: this.env });
    return { connections: r.connections, requests: r.requests, note: r.note ?? null };
  }
}
