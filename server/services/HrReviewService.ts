import type { HrConsolidated, HrConsolidatedSaved, HrReview, HrReviewDepartment, HrReviewLog, HrReviewSaved, HrReviewsOverview, WorkReportDetail } from '../../shared/contracts.js';
import { hrConsolidatedSaveSchema, hrReviewLogQuerySchema, hrReviewSaveSchema, hrReviewsQuerySchema, reportWeekQuerySchema, uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { HrReviewRepository } from '../repositories/HrReviewRepository.js';

const PAGE = 25;

/**
 * HR performance reviews and the consolidated report. Who is HR (or the Super Admin, for reading) is decided by the database from the caller's
 * login; this layer validates the input with the same schemas the forms use.
 */
export class HrReviewService {
  constructor(private readonly repo: HrReviewRepository) {}

  overview(query: unknown): Promise<HrReviewsOverview> { return this.repo.overview(parse(hrReviewsQuerySchema, query ?? {}).weekStart); }
  department(packageId: string): Promise<HrReviewDepartment> { return this.repo.department(parse(uuidSchema, packageId)); }
  personReports(packageId: string, personId: string): Promise<WorkReportDetail[]> { return this.repo.personReports(parse(uuidSchema, packageId), parse(uuidSchema, personId)); }
  save(body: unknown): Promise<HrReviewSaved> { return this.repo.save(parse(hrReviewSaveSchema, body)); }
  history(subjectId: string): Promise<HrReview[]> { return this.repo.history(parse(uuidSchema, subjectId)); }
  log(query: unknown): Promise<HrReviewLog> {
    const q = parse(hrReviewLogQuerySchema, query ?? {});
    return this.repo.log({ department: q.department, search: q.search, limit: PAGE, offset: (q.page - 1) * PAGE });
  }
  consolidated(query: unknown): Promise<HrConsolidated> { return this.repo.consolidated(parse(reportWeekQuerySchema, query).weekStart); }
  consolidatedSave(body: unknown): Promise<HrConsolidatedSaved> { return this.repo.consolidatedSave(parse(hrConsolidatedSaveSchema, body)); }
}
