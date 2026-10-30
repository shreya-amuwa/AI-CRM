import type {
  CaseDepartment, CaseMyDetails, ClientDocumentUrl, EmployeeIssue, EmployeeIssueDetail, EmployeeIssueList, EmployeeIssueOverview, EmployeeMeeting, EmployeeMeetingDetail, EmployeeMeetingList,
  EmployeeMeetingOverview, HrAssignee, IssueUploadTicket
} from '../../shared/contracts.js';
import {
  caseMyListQuerySchema, caseNoteSchema, clientFileQuerySchema, issueAssignSchema, issueHrListQuerySchema, issueReplySchema, issueRespondSchema, issueStatusSchema, issueSubmitSchema,
  issueUploadSchema, meetingAlternativeSchema, meetingCancelSchema, meetingDecideSchema, meetingHrListQuerySchema, meetingSubmitSchema, uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { EmployeeCaseRepository, IssueAttachmentRow } from '../repositories/EmployeeCaseRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const FILE_URL_TTL_SECONDS = 120;
const TABLE = 'employee_issue_attachments';

/**
 * Employee issues and meeting requests. Who may do what is decided by the database from the caller's own login: an employee sees and changes
 * only their own cases, HR staff work every case, nobody names an owner or a storage path in a request. This layer validates the input,
 * issues the signed upload / download links AFTER the database allowed them, and looks at the stored object before a file is accepted.
 */
export class EmployeeCaseService {
  constructor(
    private readonly repo: EmployeeCaseRepository,
    private readonly storage: StorageRepository
  ) {}

  // ---- issues: the employee
  submitIssue(body: unknown): Promise<EmployeeIssue> { return this.repo.submitIssue(parse(issueSubmitSchema, body)); }
  myDetails(): Promise<CaseMyDetails> { return this.repo.myDetails(); }
  myIssues(query: unknown): Promise<EmployeeIssueList> { return this.repo.myIssues(parse(caseMyListQuerySchema, query)); }
  myIssue(id: string): Promise<EmployeeIssueDetail> { return this.repo.myIssue(parse(uuidSchema, id)); }
  replyToIssue(id: string, body: unknown): Promise<EmployeeIssueDetail> {
    const i = parse(issueReplySchema, body);
    return this.repo.replyToIssue(parse(uuidSchema, id), i.message, i.attachmentIds);
  }

  // ---- issues: HR
  issueOverview(): Promise<EmployeeIssueOverview> { return this.repo.issueOverview(); }
  assignees(): Promise<HrAssignee[]> { return this.repo.assignees(); }
  departments(): Promise<CaseDepartment[]> { return this.repo.departments(); }
  hrIssues(query: unknown): Promise<EmployeeIssueList> { return this.repo.hrIssues(parse(issueHrListQuerySchema, query)); }
  hrIssue(id: string): Promise<EmployeeIssueDetail> { return this.repo.hrIssue(parse(uuidSchema, id)); }
  assignIssue(id: string, body: unknown): Promise<EmployeeIssueDetail> { return this.repo.assignIssue(parse(uuidSchema, id), parse(issueAssignSchema, body).hrId); }
  setIssueStatus(id: string, body: unknown): Promise<EmployeeIssueDetail> {
    const i = parse(issueStatusSchema, body);
    return this.repo.setIssueStatus(parse(uuidSchema, id), i.status, i.message);
  }
  respondToIssue(id: string, body: unknown): Promise<EmployeeIssueDetail> {
    const i = parse(issueRespondSchema, body);
    return this.repo.respondToIssue(parse(uuidSchema, id), i.message, i.requestInfo);
  }
  noteOnIssue(id: string, body: unknown): Promise<EmployeeIssueDetail> { return this.repo.noteOnIssue(parse(uuidSchema, id), parse(caseNoteSchema, body).note); }

  // ---- meetings: the employee
  submitMeeting(body: unknown): Promise<EmployeeMeeting> { return this.repo.submitMeeting(parse(meetingSubmitSchema, body)); }
  myMeetings(query: unknown): Promise<EmployeeMeetingList> { return this.repo.myMeetings(parse(caseMyListQuerySchema, query)); }
  myMeeting(id: string): Promise<EmployeeMeetingDetail> { return this.repo.myMeeting(parse(uuidSchema, id)); }
  cancelMyMeeting(id: string, body: unknown): Promise<EmployeeMeetingDetail> { return this.repo.cancelMyMeeting(parse(uuidSchema, id), parse(meetingCancelSchema, body ?? {}).reason); }
  answerAlternative(id: string, body: unknown): Promise<EmployeeMeetingDetail> {
    const i = parse(meetingAlternativeSchema, body);
    return this.repo.answerAlternative(parse(uuidSchema, id), i.accept, i.message);
  }

  // ---- meetings: HR
  meetingOverview(): Promise<EmployeeMeetingOverview> { return this.repo.meetingOverview(); }
  hrMeetings(query: unknown): Promise<EmployeeMeetingList> { return this.repo.hrMeetings(parse(meetingHrListQuerySchema, query)); }
  hrMeeting(id: string): Promise<EmployeeMeetingDetail> { return this.repo.hrMeeting(parse(uuidSchema, id)); }
  assignMeeting(id: string, body: unknown): Promise<EmployeeMeetingDetail> { return this.repo.assignMeeting(parse(uuidSchema, id), parse(issueAssignSchema, body).hrId); }
  noteOnMeeting(id: string, body: unknown): Promise<EmployeeMeetingDetail> { return this.repo.noteOnMeeting(parse(uuidSchema, id), parse(caseNoteSchema, body).note); }
  decideMeeting(id: string, body: unknown): Promise<EmployeeMeetingDetail> {
    const { action, ...rest } = parse(meetingDecideSchema, body);
    return this.repo.decideMeeting(parse(uuidSchema, id), { action, ...rest });
  }

  // ---- attachments
  /** Books the upload in the database (it checks the person, the type and the size), then hands out the one signed upload for it. */
  async beginUpload(body: unknown): Promise<IssueUploadTicket> {
    const i = parse(issueUploadSchema, body);
    const row = await this.repo.beginUpload(i.fileName, i.mimeType, i.sizeBytes);
    try {
      const target = await this.storage.createUploadTarget(row.id, row.storage_bucket, row.storage_path, row.mime_type, TABLE);
      return {
        attachment: { id: row.id, name: row.file_name, mime: row.mime_type, size: Number(row.size_bytes) },
        bucket: row.storage_bucket,
        path: row.storage_path,
        provider: target.provider,
        token: target.token ?? '',
        ...(target.url ? { upload: { url: target.url, headers: target.headers ?? {} } } : {})
      };
    } catch (err) {
      await this.repo.abortUpload(row.id).catch(() => undefined);
      throw err;
    }
  }

  /** The browser says the file is stored: look at the stored object (exists, size, content matches its type), then finish. */
  async completeUpload(id: string) {
    const attId = parse(uuidSchema, id);
    const row = await this.repo.pendingUpload(attId);
    const object = await this.storage.inspectFile(row.storage_provider, row.storage_bucket, row.storage_path, row.mime_type);
    if (!object.exists) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file did not finish uploading. Please try again.');
    }
    if (!object.matches) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file content does not match its type. Please attach the original file.');
    }
    try {
      const done = await this.repo.completeUpload(attId, object.size, object.etag);
      await this.storage.recordStored(attId, row.storage_provider, { reference: object.reference, etag: object.etag }, TABLE);
      return done;
    } catch (err) {
      await this.discard(row);
      throw err;
    }
  }

  async abortUpload(id: string): Promise<null> {
    const attId = parse(uuidSchema, id);
    const row = await this.repo.pendingUpload(attId).catch(() => null);
    if (row) await this.discard(row);
    return null;
  }

  private async discard(row: IssueAttachmentRow) {
    await this.repo.abortUpload(row.id).catch(() => undefined);
    await this.storage.remove(row.storage_bucket, [row.storage_path], row.storage_provider).catch(() => undefined);
  }

  /** A short-lived link, issued only if the database says this caller may read the file. */
  async attachmentUrl(id: string, query: unknown): Promise<ClientDocumentUrl> {
    const { action } = parse(clientFileQuerySchema, query ?? {});
    const row = await this.repo.attachmentFile(parse(uuidSchema, id));
    const url = await this.storage.signedDownloadUrl(row.storage_bucket, row.storage_path, FILE_URL_TTL_SECONDS, action === 'download' ? row.file_name : undefined, row.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: row.file_name };
  }
}
