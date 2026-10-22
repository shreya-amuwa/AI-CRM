import type { PerformanceHistoryEntry, PerformancePeople, PerformanceReport } from '../../shared/contracts.js';
import { performancePeopleQuerySchema, performanceReportBodySchema, performanceReportQuerySchema, uuidSchema } from '../../shared/validation.js';
import { hasServiceClient } from '../db/supabase.js';
import { parse } from '../http/validate.js';
import { aiSettings } from '../performance/ai.js';
import { writeNarrative } from '../performance/writer.js';
import type { PerformanceRepository, ReportKey } from '../repositories/PerformanceRepository.js';

/**
 * Performance reports for Team Leads and Department Heads. Who may see what is decided by the database (Row Level Security and the
 * checks inside each function), not here: a Team Lead asking for another team's report gets a refusal from the database.
 */
export class PerformanceService {
  constructor(private readonly repo: PerformanceRepository) {}

  people(query: unknown): Promise<PerformancePeople> {
    const q = parse(performancePeopleQuerySchema, query);
    return this.repo.people({ kind: q.kind, start: q.start, end: q.end, departmentId: q.departmentId });
  }

  async report(query: unknown): Promise<PerformanceReport | null> {
    return this.repo.get(this.key(parse(performanceReportQuerySchema, query)));
  }

  /**
   * Generate or refresh. The figures are recalculated from the tasks; if nothing changed, no new version is made. The written analysis
   * is (re)written only when the figures changed, when it is missing, or when it failed / was written without AI and AI is now configured.
   */
  async generate(body: unknown): Promise<{ state: string; report: PerformanceReport }> {
    const key = this.key(parse(performanceReportBodySchema, body));
    const res = await this.repo.refresh(key);
    const ai = aiSettings();
    const r = res.report;
    const needs = !r.narrative || r.aiStatus === 'PENDING' || (r.aiStatus === 'FAILED') || (r.aiStatus === 'NOT_CONFIGURED' && !!ai.apiKey);
    if (needs && hasServiceClient()) {
      try {
        await writeNarrative({ id: r.id, fingerprint: r.fingerprint, scope: r.scope, subjectName: r.subjectName, subjectRole: r.subjectRole, periodKind: r.periodKind, metrics: r.metrics });
      } catch (err) {
        console.error('[performance] could not store the written analysis', err instanceof Error ? err.message : err);
      }
      const fresh = await this.repo.get(key);
      if (fresh) return { state: res.state, report: fresh };
    }
    return res;
  }

  history(reportId: string): Promise<PerformanceHistoryEntry[]> {
    return this.repo.history(parse(uuidSchema, reportId));
  }

  private key(q: { scope: 'MEMBER' | 'TEAM' | 'DEPARTMENT'; subjectId?: string; teamId?: string; departmentId?: string; kind: string; start: string; end: string }): ReportKey {
    return { scope: q.scope, subjectId: q.subjectId, teamId: q.teamId, departmentId: q.departmentId, kind: q.kind, start: q.start, end: q.end };
  }
}
