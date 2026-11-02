import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnalysisFacts, AnalysisNarrative } from '../../shared/contracts.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { aiSettings, type AiSettings } from '../performance/ai.js';
import { analyseWithAi } from './ai.js';
import { ruleNarrative } from './narrative.js';

export interface WrittenAnalysis {
  narrative: AnalysisNarrative;
  source: 'AI' | 'RULES';
  status: 'OK' | 'FAILED' | 'NOT_CONFIGURED';
  model: string | null;
  error: string | null;
}

/**
 * Writes the analysis of a set of facts: by the AI when a key is configured; if the AI fails (or answers something that cannot be traced to the
 * facts) the rule-based analysis is used and the failure is recorded, never hidden.
 */
export async function writeAnalysis(facts: AnalysisFacts, ai: AiSettings = aiSettings()): Promise<WrittenAnalysis> {
  const rules = ruleNarrative(facts);
  if (!ai.apiKey) return { narrative: rules, source: 'RULES', status: 'NOT_CONFIGURED', model: null, error: null };
  const res = await analyseWithAi(ai, facts);
  if (res.ok) return { narrative: res.narrative, source: 'AI', status: 'OK', model: res.model, error: null };
  return { narrative: rules, source: 'RULES', status: 'FAILED', model: null, error: res.error };
}

/** Facts -> analysis -> stored (service key). Returns what was written. */
export async function generateAndStoreAnalysis(from: string, to: string, opts: { db?: SupabaseClient; ai?: AiSettings } = {}): Promise<WrittenAnalysis & { id: string }> {
  const db = opts.db ?? getServiceClient();
  const factsRes = await db.rpc('report_analysis_facts_service', { p_from: from, p_to: to });
  if (factsRes.error) throw new Error(`report_analysis_facts_service: ${factsRes.error.message}`);
  const facts = factsRes.data as AnalysisFacts;
  const written = await writeAnalysis(facts, opts.ai);
  const stored = await db.rpc('report_analysis_store', {
    p_from: from, p_to: to, p_facts: facts, p_narrative: written.narrative, p_source: written.source, p_status: written.status, p_model: written.model, p_error: written.error
  });
  if (stored.error) throw new Error(`report_analysis_store: ${stored.error.message}`);
  return { ...written, id: stored.data as string };
}

export interface ReportAnalysisRunSummary { weeks: number; written: number; ai: { configured: boolean; ok: number; failed: number }; note?: string }

/** The daily run: write the analysis of every consolidated week that is still waiting for it (idempotent, at most 3 per run). */
export async function runReportAnalysisAutomation(opts: { db?: SupabaseClient; ai?: AiSettings } = {}): Promise<ReportAnalysisRunSummary> {
  const ai = opts.ai ?? aiSettings();
  const out: ReportAnalysisRunSummary = { weeks: 0, written: 0, ai: { configured: !!ai.apiKey, ok: 0, failed: 0 } };
  if (!opts.db && !hasServiceClient()) return { ...out, note: 'The server has no service key.' };
  const db = opts.db ?? getServiceClient();
  const pending = await db.rpc('report_analysis_pending');
  if (pending.error) throw new Error(`report_analysis_pending: ${pending.error.message}`);
  const weeks = (pending.data || []) as { from: string; to: string }[];
  out.weeks = weeks.length;
  for (const w of weeks.slice(0, 3)) {
    const r = await generateAndStoreAnalysis(w.from, w.to, { db, ai });
    out.written++;
    if (r.source === 'AI') out.ai.ok++;
    if (r.status === 'FAILED') out.ai.failed++;
  }
  return out;
}
