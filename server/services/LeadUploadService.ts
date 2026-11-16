import type { LeadUploadBatch, LeadUploadCheckResult, LeadUploadChunkResult, LeadUploadIssues, LeadUploadRawRow } from '../../shared/contracts.js';
import { prepareLeadUploadRow } from '../../shared/leadUpload.js';
import { leadUploadCheckSchema, leadUploadRowsSchema, leadUploadStartSchema, uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { LeadUploadRepository } from '../repositories/LeadUploadRepository.js';

/**
 * Upload Leads (docs/LEAD_UPLOAD.md). Every row is checked here with the Add Lead rules; a row that fails goes to the database marked with its
 * problem, so it is reported (and kept in the upload's error log) with its row number. The database checks the row again, finds duplicates,
 * decides the owner and creates each lead with the Add Lead function.
 */
export class LeadUploadService {
  constructor(private readonly repo: LeadUploadRepository) {}

  private toDatabase(raw: LeadUploadRawRow) {
    const p = prepareLeadUploadRow(raw);
    const { row: _row, ...values } = raw;
    return { row: p.row, ...(p.fields ?? {}), services: p.services, assignee: p.assignee, problem: p.problem, raw: values };
  }

  check(body: unknown): Promise<LeadUploadCheckResult> {
    return this.repo.check(parse(leadUploadCheckSchema, body).rows.map(r => this.toDatabase(r)));
  }

  start(body: unknown): Promise<LeadUploadBatch> {
    return this.repo.start(parse(leadUploadStartSchema, body));
  }

  rows(id: string, body: unknown): Promise<LeadUploadChunkResult> {
    return this.repo.rows(parse(uuidSchema, id), parse(leadUploadRowsSchema, body).rows.map(r => this.toDatabase(r)));
  }

  finish(id: string): Promise<LeadUploadBatch> { return this.repo.finish(parse(uuidSchema, id)); }
  history(): Promise<LeadUploadBatch[]> { return this.repo.history(); }
  issues(id: string): Promise<LeadUploadIssues> { return this.repo.issues(parse(uuidSchema, id)); }
}
