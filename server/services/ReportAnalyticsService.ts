import type { EmployeeProfile, Leaderboard, LeaderboardOptions, ReportAnalysisView, ReportSettings, SaConsolidated, SaConsolidatedListItem } from '../../shared/contracts.js';
import { reportAnalysisQuerySchema, reportEmployeeProfileQuerySchema, reportLeaderboardQuerySchema, reportSettingsSchema, uuidSchema } from '../../shared/validation.js';
import { hasServiceClient } from '../db/supabase.js';
import { parse } from '../http/validate.js';
import { aiSettings } from '../performance/ai.js';
import type { ReportAnalyticsRepository } from '../repositories/ReportAnalyticsRepository.js';
import { generateAndStoreAnalysis, writeAnalysis } from '../reportAnalysis/writer.js';

/**
 * The Super Admin's performance views: consolidated reports, the Leaderboard, one employee, the scoring settings and the analysis. The database
 * refuses anybody else. The analysis is written from the facts the database returns for the CALLER (the Super Admin); the service key is only
 * used to store the written analysis.
 */
export class ReportAnalyticsService {
  constructor(private readonly repo: ReportAnalyticsRepository) {}

  consolidatedList(): Promise<SaConsolidatedListItem[]> { return this.repo.consolidatedList(); }
  consolidated(id: string): Promise<SaConsolidated> { return this.repo.consolidated(parse(uuidSchema, id)); }
  leaderboard(query: unknown): Promise<Leaderboard> { return this.repo.leaderboard(parse(reportLeaderboardQuerySchema, query ?? {})); }
  options(): Promise<LeaderboardOptions> { return this.repo.options(); }
  employee(id: string, query: unknown): Promise<EmployeeProfile> { return this.repo.employee(parse(uuidSchema, id), parse(reportEmployeeProfileQuerySchema, query ?? {})); }
  settings(): Promise<ReportSettings> { return this.repo.settings(); }
  updateSettings(body: unknown): Promise<ReportSettings> { return this.repo.updateSettings(parse(reportSettingsSchema, body)); }

  /** The measurable facts of the period (always live) and the latest written analysis, if any. */
  async analysis(query: unknown): Promise<ReportAnalysisView> {
    const q = parse(reportAnalysisQuerySchema, query);
    const [facts, analysis] = await Promise.all([this.repo.facts(q.from, q.to), this.repo.latestAnalysis(q.from, q.to)]);
    return { facts, analysis, aiConfigured: !!aiSettings().apiKey };
  }

  /** Write (or write again) the analysis of a period. The caller's permission is checked first, by the database call that reads the facts. */
  async generate(body: unknown): Promise<ReportAnalysisView> {
    const q = parse(reportAnalysisQuerySchema, body);
    const facts = await this.repo.facts(q.from, q.to);
    if (hasServiceClient()) await generateAndStoreAnalysis(q.from, q.to);
    const analysis = hasServiceClient() ? await this.repo.latestAnalysis(q.from, q.to) : null;
    if (!analysis) {
      // no service key to store it: the analysis is still written and shown, but not kept
      const w = await writeAnalysis(facts);
      return { facts, aiConfigured: !!aiSettings().apiKey, analysis: { id: 'unsaved', periodStart: q.from, periodEnd: q.to, facts, narrative: w.narrative, source: w.source, status: w.status, model: w.model, error: w.error, createdAt: new Date().toISOString() } };
    }
    return { facts, analysis, aiConfigured: !!aiSettings().apiKey };
  }
}
