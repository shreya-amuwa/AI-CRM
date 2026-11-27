import type { ImprovementRequestResult, ImprovementRequestRow, PreviewRecent, PreviewSession } from '../../shared/contracts.js';
import { improvementRequestSchema, previewSessionEndSchema, previewSessionSchema } from '../../shared/dashboardExplorer.js';
import { parse } from '../http/validate.js';
import type { DashboardExplorerRepository } from '../repositories/DashboardExplorerRepository.js';

/**
 * Dashboard Explorer (docs/DASHBOARD_EXPLORER.md). The dashboards themselves are previewed in an isolated frame with demonstration data and
 * never call this API. These routes only record the Managing Director's own preview (audit), list what they viewed recently and file
 * improvement requests with the Developer Team. The dashboard id and department must be in the shared registry (validated here and again by
 * the database), and the database accepts only the active SUPER_ADMIN.
 */
export class DashboardExplorerService {
  constructor(private readonly repo: DashboardExplorerRepository) {}
  startSession(body: unknown): Promise<PreviewSession> { return this.repo.startSession(parse(previewSessionSchema, body)); }
  endSession(body: unknown) { return this.repo.endSession(parse(previewSessionEndSchema, body).sessionId); }
  recent(): Promise<PreviewRecent[]> { return this.repo.recent(); }
  suggest(body: unknown): Promise<ImprovementRequestResult> { return this.repo.suggest(parse(improvementRequestSchema, body)); }
  requests(): Promise<ImprovementRequestRow[]> { return this.repo.requests(); }
}
