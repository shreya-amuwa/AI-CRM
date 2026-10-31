import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { aiSettings, type AiSettings } from '../performance/ai.js';
import { evaluateWithAi } from './ai.js';
import { ruleEvaluation, type EvaluationInput } from './narrative.js';

export type WriteOutcome = 'AI' | 'RULES_AI_FAILED' | 'RULES_NOT_CONFIGURED' | 'STALE';

/**
 * Writes and stores the evaluation of one score. AI when a key is configured; if the AI fails (or answers nonsense) the rule-based
 * evaluation is stored instead and the failure is recorded (so the AI is tried again later), never hidden. The database refuses the write
 * when the figures changed meanwhile (the fingerprint no longer matches).
 */
export async function writeEvaluation(item: EvaluationInput, opts: { db?: SupabaseClient; ai?: AiSettings } = {}): Promise<WriteOutcome> {
  const db = opts.db ?? getServiceClient();
  const ai = opts.ai ?? aiSettings();
  let narrative = ruleEvaluation(item);
  let source: 'AI' | 'RULES' = 'RULES';
  let status: 'OK' | 'FAILED' | 'NOT_CONFIGURED' = 'NOT_CONFIGURED';
  let model: string | null = null;
  let error: string | null = null;
  let outcome: WriteOutcome = 'RULES_NOT_CONFIGURED';
  if (ai.apiKey) {
    const res = await evaluateWithAi(ai, item);
    if (res.ok) {
      narrative = res.narrative;
      source = 'AI';
      status = 'OK';
      model = res.model;
      outcome = 'AI';
    } else {
      status = 'FAILED';
      error = res.error;
      outcome = 'RULES_AI_FAILED';
    }
  }
  const { data, error: dbErr } = await db.rpc('performer_evaluation_store', {
    p_score: item.scoreId, p_fingerprint: item.fingerprint, p_narrative: narrative, p_source: source, p_status: status, p_model: model, p_error: error
  });
  if (dbErr) throw new Error(`performer_evaluation_store: ${dbErr.message}`);
  return data === false ? 'STALE' : outcome;
}

export interface EvaluationBatchResult {
  written: number;
  ai: { configured: boolean; ok: number; failed: number };
}

/** Writes the missing evaluations of one department and month (at most `limit`, within `budgetMs`). */
export async function writeMissingEvaluations(
  department: string, month: string, opts: { db?: SupabaseClient; ai?: AiSettings; budgetMs?: number; limit?: number } = {}
): Promise<EvaluationBatchResult> {
  const ai = opts.ai ?? aiSettings();
  const out: EvaluationBatchResult = { written: 0, ai: { configured: !!ai.apiKey, ok: 0, failed: 0 } };
  if (!opts.db && !hasServiceClient()) return out;
  const db = opts.db ?? getServiceClient();
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  while (Date.now() < deadline && out.written < (opts.limit ?? 30)) {
    const { data, error } = await db.rpc('performer_evaluations_to_write', { p_department: department, p_month: month, p_limit: 5, p_retry_not_configured: !!ai.apiKey });
    if (error) throw new Error(`performer_evaluations_to_write: ${error.message}`);
    const batch = (data || []) as EvaluationInput[];
    if (batch.length === 0) break;
    let progressed = 0;
    for (const item of batch) {
      if (Date.now() >= deadline) break;
      const o = await writeEvaluation(item, { db, ai });
      if (o === 'AI') out.ai.ok++;
      if (o === 'RULES_AI_FAILED') out.ai.failed++;
      if (o !== 'STALE') progressed++;
      out.written++;
    }
    // evaluations whose AI call failed are tried again after six hours by the database; stop when nothing moved forward
    if (progressed === 0 || out.ai.failed > 0) break;
  }
  return out;
}

export interface TopPerformersRunSummary {
  schedule: { day?: string; departments?: number; skipped?: string } | null;
  written: number;
  ai: { configured: boolean; ok: number; failed: number };
  note?: string;
}

/**
 * The daily run (safe to call as often as you like): recalculate this month and last month for every department, keep a version where
 * the figures changed, prepare the monthly recommendations, then write the missing evaluations.
 */
export async function runTopPerformersAutomation(opts: { db?: SupabaseClient; ai?: AiSettings; budgetMs?: number } = {}): Promise<TopPerformersRunSummary> {
  const ai = opts.ai ?? aiSettings();
  const out: TopPerformersRunSummary = { schedule: null, written: 0, ai: { configured: !!ai.apiKey, ok: 0, failed: 0 } };
  if (!opts.db && !hasServiceClient()) return { ...out, note: 'The server has no service key.' };
  const db = opts.db ?? getServiceClient();
  const sched = await db.rpc('performer_schedule', { p_today: null });
  if (sched.error) throw new Error(`performer_schedule: ${sched.error.message}`);
  const run = sched.data as { departmentIds?: string[]; months?: string[]; day?: string; departments?: number; skipped?: string };
  out.schedule = { day: run.day, departments: run.departments, skipped: run.skipped };
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  for (const dept of run.departmentIds ?? []) {
    for (const month of run.months ?? []) {
      if (Date.now() >= deadline) return out;
      const r = await writeMissingEvaluations(dept, month, { db, ai, budgetMs: Math.max(1000, deadline - Date.now()), limit: 30 });
      out.written += r.written;
      out.ai.ok += r.ai.ok;
      out.ai.failed += r.ai.failed;
    }
  }
  return out;
}
