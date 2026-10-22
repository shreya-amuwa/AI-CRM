import type { SupabaseClient } from '@supabase/supabase-js';
import type { PerformanceMetrics, PerformanceNarrative } from '../../shared/contracts.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { aiSettings, writeWithAi, type AiSettings } from './ai.js';
import { ruleNarrative, type NarrativeSubject } from './narrative.js';

/** What the database hands over for a report that still needs its written analysis. */
export interface ReportToWrite {
  id: string;
  fingerprint: string;
  scope: 'MEMBER' | 'TEAM' | 'DEPARTMENT';
  subjectName: string;
  subjectRole: string | null;
  periodKind: string;
  metrics: PerformanceMetrics;
}

export type WriteOutcome = 'AI' | 'RULES_AI_FAILED' | 'RULES_NOT_CONFIGURED' | 'STALE';

/**
 * Writes the analysis of one report and stores it. AI when a key is configured; if the AI service fails (or answers nonsense) the
 * rule-based analysis is stored instead and the failure is recorded on the report (so it is retried later), never hidden.
 * The database refuses the write if the report's figures changed meanwhile (the fingerprint no longer matches).
 */
export async function writeNarrative(r: ReportToWrite, opts: { db?: SupabaseClient; ai?: AiSettings } = {}): Promise<WriteOutcome> {
  const db = opts.db ?? getServiceClient();
  const ai = opts.ai ?? aiSettings();
  const subject: NarrativeSubject = { name: r.subjectName, role: r.subjectRole, scope: r.scope };
  let narrative: PerformanceNarrative;
  let source: 'AI' | 'RULES';
  let status: 'OK' | 'FAILED' | 'NOT_CONFIGURED';
  let model: string | null = null;
  let error: string | null = null;
  let outcome: WriteOutcome;
  if (!ai.apiKey) {
    narrative = ruleNarrative(subject, r.metrics);
    source = 'RULES';
    status = 'NOT_CONFIGURED';
    outcome = 'RULES_NOT_CONFIGURED';
  } else {
    const res = await writeWithAi(ai, subject, r.periodKind, r.metrics);
    if (res.ok) {
      narrative = res.narrative;
      source = 'AI';
      status = 'OK';
      model = res.model;
      outcome = 'AI';
    } else {
      narrative = ruleNarrative(subject, r.metrics);
      source = 'RULES';
      status = 'FAILED';
      error = res.error;
      outcome = 'RULES_AI_FAILED';
    }
  }
  const { data, error: dbErr } = await db.rpc('performance_report_store_narrative', {
    p_report: r.id, p_fingerprint: r.fingerprint, p_narrative: narrative, p_source: source, p_status: status, p_model: model, p_error: error
  });
  if (dbErr) throw new Error(`performance_report_store_narrative: ${dbErr.message}`);
  return data === false ? 'STALE' : outcome;
}

export interface PerformanceRunSummary {
  schedule: { day?: string; created?: number; updated?: number; unchanged?: number; skippedNoTasks?: number; skipped?: string } | null;
  written: number;
  ai: { configured: boolean; ok: number; failed: number };
  note?: string;
}

/**
 * The scheduled run (called by the daily dispatch and safe to call as often as you like): the database decides which reports are due
 * (a report is made or changed only when the task figures changed; a second run changes nothing), then the missing analyses are written.
 */
export async function runPerformanceAutomation(opts: { db?: SupabaseClient; ai?: AiSettings; budgetMs?: number; limit?: number } = {}): Promise<PerformanceRunSummary> {
  const ai = opts.ai ?? aiSettings();
  const out: PerformanceRunSummary = { schedule: null, written: 0, ai: { configured: !!ai.apiKey, ok: 0, failed: 0 } };
  if (!opts.db && !hasServiceClient()) return { ...out, note: 'The server has no service key.' };
  const db = opts.db ?? getServiceClient();
  const sched = await db.rpc('performance_schedule', { p_today: null });
  if (sched.error) throw new Error(`performance_schedule: ${sched.error.message}`);
  out.schedule = sched.data;
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  while (Date.now() < deadline && out.written < (opts.limit ?? 30)) {
    const { data, error } = await db.rpc('performance_reports_to_write', { p_limit: 5, p_retry_not_configured: !!ai.apiKey });
    if (error) throw new Error(`performance_reports_to_write: ${error.message}`);
    const batch = (data || []) as ReportToWrite[];
    if (batch.length === 0) break;
    let progressed = 0;
    for (const r of batch) {
      if (Date.now() >= deadline) break;
      const o = await writeNarrative(r, { db, ai });
      if (o === 'AI') out.ai.ok++;
      if (o === 'RULES_AI_FAILED') out.ai.failed++;
      if (o !== 'STALE') progressed++;
      out.written++;
    }
    // reports whose AI call failed are retried after six hours by the database; stop when nothing moved forward
    if (progressed === 0 || out.ai.failed > 0) break;
  }
  return out;
}
