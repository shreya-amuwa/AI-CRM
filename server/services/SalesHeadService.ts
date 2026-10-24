import { createHash } from 'node:crypto';
import type {
  SalesIncome, SalesLeadAssignee, SalesLeadDetail, SalesLeadList, SalesOverview, SalesReport, SalesSheet, SalesSheetCheck, SalesTaskAssignee, SalesTaskList
} from '../../shared/contracts.js';
import {
  TELECALLER_SHEET_MAX_BYTES, salesInboundAssignSchema, salesIncomeQuerySchema, salesLeadSheetSchema, salesLeadsQuerySchema, salesReportsQuerySchema,
  salesTaskCreateSchema, salesTasksQuerySchema, telecallerSheetSourceSchema, uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { SalesHeadRepository } from '../repositories/SalesHeadRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const BUCKET = 'telecaller-sheets';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Sales Department Head. The browser reads the Excel file; the rows are checked again here and in the database, which lists every row it
 * leaves out. The original file is stored afterwards, only for a sheet the database has just allowed this person to assign.
 */
export class SalesHeadService {
  constructor(private readonly repo: SalesHeadRepository, private readonly storage: StorageRepository) {}

  overview(): Promise<SalesOverview> { return this.repo.overview(); }

  assignees(): Promise<SalesLeadAssignee[]> { return this.repo.assignees(); }
  sheets(): Promise<SalesSheet[]> { return this.repo.sheets(); }
  /** Check a sheet (commit false: the preview) or assign it (commit true). */
  assignSheet(body: unknown): Promise<SalesSheetCheck> { return this.repo.assignSheet(parse(salesLeadSheetSchema, body)); }

  /** The original .xlsx, base64, up to 700 KB: the first bytes must be a real .xlsx (zip) and the file must be the one that was assigned. */
  async storeSource(sheetId: string, body: unknown) {
    const id = parse(uuidSchema, sheetId);
    const { data } = parse(telecallerSheetSourceSchema, body);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new AppError('VALIDATION_ERROR', 'The file could not be read.');
    const bytes = new Uint8Array(Buffer.from(data, 'base64'));
    if (bytes.length === 0 || bytes.length > TELECALLER_SHEET_MAX_BYTES) throw new AppError('VALIDATION_ERROR', 'The Excel file is too large (700 KB at most).');
    const head = Buffer.from(bytes.subarray(0, 4));
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) throw new AppError('VALIDATION_ERROR', 'This is not an Excel (.xlsx) file.');
    const sheet = await this.repo.sourceBegin(id); // the database decides who may attach a file to this sheet
    if (createHash('sha256').update(bytes).digest('hex') !== sheet.contentHash) throw new AppError('VALIDATION_ERROR', 'The file is not the one that was checked.');
    const path = `${sheet.departmentId}/sales-sheets/${id}.xlsx`;
    const file = await this.storage.storeGenerated(BUCKET, path, bytes, XLSX);
    await this.repo.recordSource(id, { bucket: BUCKET, path, provider: file.provider, reference: file.reference, etag: file.etag, size: file.size });
    return { stored: true as const, size: file.size };
  }

  leads(query: unknown): Promise<SalesLeadList> { return this.repo.leads(parse(salesLeadsQuerySchema, query)); }
  lead(id: string): Promise<SalesLeadDetail> {
    if (!id || id.length > 80) throw new AppError('VALIDATION_ERROR', 'Lead not found.');
    return this.repo.lead(id);
  }
  assignInbound(id: string, body: unknown) {
    if (!id || id.length > 80) throw new AppError('VALIDATION_ERROR', 'Lead not found.');
    return this.repo.assignInbound(id, parse(salesInboundAssignSchema, body).assigneeId);
  }

  tasks(query: unknown): Promise<SalesTaskList> { return this.repo.tasks(parse(salesTasksQuerySchema, query)); }
  taskAssignees(): Promise<SalesTaskAssignee[]> { return this.repo.taskAssignees(); }
  async createTask(body: unknown): Promise<{ id: string }> { return { id: await this.repo.createTask(parse(salesTaskCreateSchema, body)) }; }

  reports(query: unknown): Promise<SalesReport> { return this.repo.reports(parse(salesReportsQuerySchema, query)); }
  income(query: unknown): Promise<SalesIncome> { return this.repo.income(parse(salesIncomeQuerySchema, query)); }
}
