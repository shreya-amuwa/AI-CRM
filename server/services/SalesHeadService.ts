import { createHash } from 'node:crypto';
import type {
  SalesForwardAssignee, SalesForwardResult, SalesIncome, SalesLeadAssignee, SalesReceivedSheet, SalesRoleList, SalesRolePersonDashboard, SalesTeamPerson, SalesLeadDetail, SalesLeadList, SalesOverview, SalesReport, SalesSheet, SalesSheetCheck, SalesSheetIssues, SalesTaskAssignee, SalesTaskList
} from '../../shared/contracts.js';
import {
  TELECALLER_SHEET_MAX_BYTES, salesInboundAssignSchema, salesSheetForwardSchema, salesIncomeQuerySchema, salesLeadSheetSchema, salesLeadsQuerySchema, salesReportsQuerySchema,
  salesRoleListQuerySchema, salesRolePersonQuerySchema, salesRoleSchema,
  salesTaskCreateSchema, salesTasksQuerySchema, telecallerSheetSourceSchema, uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { SalesHeadRepository } from '../repositories/SalesHeadRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const BUCKET = 'telecaller-sheets';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The kinds of original file a sheet may come from, told by their first bytes (never by the name the browser gives). */
const XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
function sheetFormat(bytes: Uint8Array): { ext: 'xlsx' | 'xls' | 'csv'; mime: string } | null {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return { ext: 'xlsx', mime: XLSX };
  if (XLS_SIGNATURE.every((b, i) => bytes[i] === b)) return { ext: 'xls', mime: 'application/vnd.ms-excel' };
  // a CSV is text: no NUL byte and no other control characters than tab / line ends
  if (!bytes.some(b => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) return { ext: 'csv', mime: 'text/csv' };
  return null;
}

/**
 * Sales Department Head. The browser reads the Excel file; the rows are checked again here and in the database, which lists every row it
 * leaves out. The original file is stored afterwards, only for a sheet the database has just allowed this person to assign.
 */
export class SalesHeadService {
  constructor(private readonly repo: SalesHeadRepository, private readonly storage: StorageRepository) {}

  overview(): Promise<SalesOverview> { return this.repo.overview(); }

  assignees(): Promise<SalesLeadAssignee[]> { return this.repo.assignees(); }
  teamPeople(): Promise<SalesTeamPerson[]> { return this.repo.teamPeople(); }
  sheets(): Promise<SalesSheet[]> { return this.repo.sheets(); }
  /** Check a sheet (commit false: the preview) or assign it (commit true). */
  assignSheet(body: unknown): Promise<SalesSheetCheck> { return this.repo.assignSheet(parse(salesLeadSheetSchema, body)); }

  /** A Department Head's sheets received from the CEO, who they can forward one to, and forwarding its open leads (20270303000100). */
  received(): Promise<SalesReceivedSheet[]> { return this.repo.received(); }
  forwardAssignees(sheetId: string): Promise<SalesForwardAssignee[]> { return this.repo.forwardAssignees(parse(uuidSchema, sheetId)); }
  forward(sheetId: string, body: unknown): Promise<SalesForwardResult> {
    const { assigneeId, count } = parse(salesSheetForwardSchema, body);
    return this.repo.forward(parse(uuidSchema, sheetId), assigneeId, count ?? null);
  }
  /** The rows left out of one uploaded sheet (the database checks it is a sheet of the caller's department). */
  sheetIssues(sheetId: string): Promise<SalesSheetIssues> { return this.repo.sheetIssues(parse(uuidSchema, sheetId)); }

  /** The original .xlsx, .xls or .csv, base64, up to 700 KB: its first bytes must be one of those and the file must be the one that was assigned. */
  async storeSource(sheetId: string, body: unknown) {
    const id = parse(uuidSchema, sheetId);
    const { data } = parse(telecallerSheetSourceSchema, body);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new AppError('VALIDATION_ERROR', 'The file could not be read.');
    const bytes = new Uint8Array(Buffer.from(data, 'base64'));
    if (bytes.length === 0 || bytes.length > TELECALLER_SHEET_MAX_BYTES) throw new AppError('VALIDATION_ERROR', 'The Excel file is too large (700 KB at most).');
    const format = sheetFormat(bytes);
    if (!format) throw new AppError('VALIDATION_ERROR', 'This is not an Excel (.xlsx, .xls) or CSV file.');
    const sheet = await this.repo.sourceBegin(id); // the database decides who may attach a file to this sheet
    if (createHash('sha256').update(bytes).digest('hex') !== sheet.contentHash) throw new AppError('VALIDATION_ERROR', 'The file is not the one that was checked.');
    const path = `${sheet.departmentId}/sales-sheets/${id}.${format.ext}`;
    const file = await this.storage.storeGenerated(BUCKET, path, bytes, format.mime);
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

  /** Role-wise sections: the people of one Sales role and one person's dashboard (the database checks the head and the scope). */
  roleList(role: string, query: unknown): Promise<SalesRoleList> {
    return this.repo.roleList(parse(salesRoleSchema, role), parse(salesRoleListQuerySchema, query));
  }
  rolePerson(role: string, profileId: string, query: unknown): Promise<SalesRolePersonDashboard> {
    return this.repo.rolePerson(parse(salesRoleSchema, role), parse(uuidSchema, profileId), parse(salesRolePersonQuerySchema, query));
  }
}
