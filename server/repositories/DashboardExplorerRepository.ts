import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImprovementRequestResult, ImprovementRequestRow, PreviewRecent, PreviewSession } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** Dashboard Explorer (20270225000100): each call is a database function that accepts only the active Managing Director. */
export class DashboardExplorerRepository {
  constructor(private readonly db: SupabaseClient) {}
  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }
  startSession(p: { dashboardId: string; department: string; scenario: string }) { return this.rpc<PreviewSession>('dashboard_explorer_session_start', { p }); }
  endSession(sessionId: string) { return this.rpc<{ sessionId: string; ended: boolean }>('dashboard_explorer_session_end', { p_session: sessionId }); }
  recent() { return this.rpc<PreviewRecent[]>('dashboard_explorer_recent'); }
  suggest(p: Record<string, unknown>) { return this.rpc<ImprovementRequestResult>('dashboard_explorer_suggest', { p }); }
  requests() { return this.rpc<ImprovementRequestRow[]>('dashboard_explorer_requests'); }
}
