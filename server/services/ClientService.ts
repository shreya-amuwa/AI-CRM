import type { ClientDocumentUrl, DocumentUploadTicket } from '../../shared/contracts.js';
import {
  clientActivityCustomersQuerySchema,
  clientActivitySchema,
  clientCalendarQuerySchema,
  clientDetailSchema,
  clientDismissSchema,
  clientDocumentQueueQuerySchema,
  clientDocumentReviewSchema,
  clientDocumentUploadSchema,
  clientFileQuerySchema,
  clientMarkReadSchema,
  clientNotificationsQuerySchema,
  clientPlanRequestSchema,
  clientServiceRequestSchema,
  clientTicketCreateSchema,
  clientTicketMessageSchema,
  clientTicketReplySchema,
  planRequestDecisionSchema,
  planSaveSchema,
  serviceRequestDecisionSchema,
  uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { mapDocument } from '../repositories/PipelineRepository.js';
import { parse } from '../http/validate.js';
import type { ClientRepository } from '../repositories/ClientRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const FILE_URL_TTL_SECONDS = 120;

export class ClientService {
  constructor(
    private readonly repo: ClientRepository,
    private readonly storage: StorageRepository
  ) {}

  me() { return this.repo.me(); }
  overview() { return this.repo.overview(); }
  async services() { return (await this.repo.services()) ?? []; }
  campaigns() { return this.repo.campaigns(); }
  catalog() { return this.repo.catalog(); }
  serviceRequests() { return this.repo.serviceRequests(); }
  requestService(body: unknown) {
    const i = parse(clientServiceRequestSchema, body);
    return this.repo.requestService(i.serviceCode, i.note ?? null);
  }
  cancelServiceRequest(id: string) { return this.repo.cancelServiceRequest(parse(uuidSchema, id)); }

  plans() { return this.repo.plans(); }
  requestPlan(body: unknown) {
    const i = parse(clientPlanRequestSchema, body);
    return this.repo.requestPlan(i.planId, i.note ?? null);
  }

  invoices() { return this.repo.invoices(); }
  /** A short-lived link to the PDF of one of the client's OWN invoices (the database decides; the path never comes from the request). */
  async invoiceUrl(id: string, query: unknown): Promise<ClientDocumentUrl> {
    const invoiceId = parse(uuidSchema, id);
    const { action } = parse(clientFileQuerySchema, query);
    const file = await this.repo.invoiceFile(invoiceId);
    if (!file) throw new AppError('NOT_FOUND', 'Invoice not found.');
    const url = await this.storage.signedDownloadUrl(file.storage_bucket, file.storage_path, FILE_URL_TTL_SECONDS, action === 'download' ? file.original_file_name : undefined, file.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: file.original_file_name };
  }

  tickets() { return this.repo.tickets(); }
  ticket(id: string) { return this.repo.ticket(parse(uuidSchema, id)); }
  createTicket(body: unknown) { return this.repo.createTicket(parse(clientTicketCreateSchema, body)); }
  replyTicket(id: string, body: unknown) {
    return this.repo.replyTicket(parse(uuidSchema, id), parse(clientTicketReplySchema, body).message);
  }
  sendTicketMessage(id: string, body: unknown) {
    const { message, clientMsgId, attachmentIds } = parse(clientTicketMessageSchema, body);
    return this.repo.sendTicketMessage(parse(uuidSchema, id), message, clientMsgId, attachmentIds);
  }
  async ticketSeen(id: string) { return { marked: await this.repo.ticketSeen(parse(uuidSchema, id)) }; }

  announcements() { return this.repo.announcements(); }
  async dismissAnnouncement(id: string, body: unknown) {
    const { occurrence } = parse(clientDismissSchema, body ?? {});
    await this.repo.dismissAnnouncement(parse(uuidSchema, id), occurrence || 'ONCE');
    return null;
  }

  notifications(query: unknown) {
    const { limit, offset } = parse(clientNotificationsQuerySchema, query);
    return this.repo.notifications(limit, offset);
  }
  async markRead(body: unknown) {
    const { ids } = parse(clientMarkReadSchema, body ?? {});
    return { updated: await this.repo.markRead(ids ?? null) };
  }

  // ---- calendar and documents (the client)
  calendar(query: unknown) {
    const { from, to } = parse(clientCalendarQuerySchema, query);
    return this.repo.calendar(from, to);
  }
  documents() { return this.repo.documents(); }
  saveDetail(body: unknown) {
    const i = parse(clientDetailSchema, body);
    return this.repo.saveDetail(i.itemCode, i.value).then(() => null);
  }

  /** Books the upload in the database (it checks the item, the type and the size), then hands out the one signed upload for it. */
  async beginDocumentUpload(body: unknown): Promise<DocumentUploadTicket> {
    const i = parse(clientDocumentUploadSchema, body);
    const row = await this.repo.beginDocumentUpload(i.itemCode, i.fileName, i.mimeType, i.sizeBytes);
    try {
      const target = await this.storage.createUploadTarget(row.id, row.storage_bucket, row.storage_path, row.mime_type);
      return {
        document: mapDocument(row),
        bucket: row.storage_bucket,
        path: row.storage_path,
        provider: target.provider,
        token: target.token ?? '',
        ...(target.url ? { upload: { url: target.url, headers: target.headers ?? {} } } : {})
      };
    } catch (err) {
      await this.repo.abortDocumentUpload(row.id).catch(() => undefined);
      throw err;
    }
  }

  /** The browser says the file is stored: look at the stored object (exists, size, content matches its type), then finish. */
  async completeDocumentUpload(id: string) {
    const docId = parse(uuidSchema, id);
    const doc = await this.repo.pendingDocument(docId);
    const object = await this.storage.inspectFile(doc.storage_provider, doc.storage_bucket, doc.storage_path, doc.mime_type);
    if (!object.exists) {
      await this.discard(docId, doc.storage_bucket, doc.storage_provider, doc.storage_path);
      throw new AppError('VALIDATION_ERROR', 'The file did not finish uploading. Please try again.');
    }
    if (!object.matches) {
      await this.discard(docId, doc.storage_bucket, doc.storage_provider, doc.storage_path);
      throw new AppError(
        'VALIDATION_ERROR',
        doc.mime_type === 'application/pdf'
          ? 'This file is not a valid PDF. Please combine the documents into one PDF and try again.'
          : 'The file content does not match its type. Please upload the original file.'
      );
    }
    let done;
    try {
      done = await this.repo.completeDocumentUpload(docId, object.size);
    } catch (err) {
      await this.discard(docId, doc.storage_bucket, doc.storage_provider, doc.storage_path);
      throw err;
    }
    await this.storage.recordStored(docId, doc.storage_provider, { reference: object.reference, etag: object.etag });
    this.storage.expireStaleUploads(doc.storage_bucket).catch(() => undefined);
    return mapDocument(done);
  }

  async abortDocumentUpload(id: string): Promise<null> {
    const docId = parse(uuidSchema, id);
    const doc = await this.repo.pendingDocument(docId);
    await this.discard(docId, doc.storage_bucket, doc.storage_provider, doc.storage_path);
    return null;
  }

  private async discard(docId: string, bucket: string, provider: 'SUPABASE' | 'R2' | null | undefined, path: string): Promise<void> {
    await this.repo.abortDocumentUpload(docId).catch(() => undefined);
    await this.storage.remove(bucket, [path], provider).catch(() => undefined);
  }

  /** A short-lived link to one of the client's OWN current documents (the database decides; the path never comes from the request). */
  async documentUrl(id: string, query: unknown): Promise<ClientDocumentUrl> {
    const docId = parse(uuidSchema, id);
    const { action } = parse(clientFileQuerySchema, query);
    const file = await this.repo.documentFile(docId);
    if (!file) throw new AppError('NOT_FOUND', 'Document not found.');
    const url = await this.storage.signedDownloadUrl(file.storage_bucket, file.storage_path, FILE_URL_TTL_SECONDS, action === 'download' ? file.original_file_name : undefined, file.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: file.original_file_name };
  }

  // ---- calendar and documents (the support team)
  activityCustomers(query: unknown) { return this.repo.activityCustomers(parse(clientActivityCustomersQuerySchema, query ?? {}).search || null); }
  activityList(customerId: string) { return this.repo.activityList(parse(uuidSchema, customerId)); }
  private activityInput(body: unknown) {
    const i = parse(clientActivitySchema, body);
    return { serviceCode: i.serviceCode || null, date: i.date, kind: i.kind, title: i.title, summary: i.summary || null, metrics: i.metrics };
  }
  logActivity(customerId: string, body: unknown) { return this.repo.logActivity(parse(uuidSchema, customerId), this.activityInput(body)); }
  updateActivity(id: string, body: unknown) { return this.repo.updateActivity(parse(uuidSchema, id), this.activityInput(body)); }
  deleteActivity(id: string) { return this.repo.deleteActivity(parse(uuidSchema, id)).then(() => null); }
  documentQueue(query: unknown) { return this.repo.documentQueue(parse(clientDocumentQueueQuerySchema, query ?? {}).status); }
  reviewDocument(customerId: string, itemCode: string, body: unknown) {
    const i = parse(clientDocumentReviewSchema, body);
    return this.repo.reviewDocument(parse(uuidSchema, customerId), itemCode, i.decision, i.note || null).then(() => null);
  }
  async uploadUrl(id: string, query: unknown): Promise<ClientDocumentUrl> {
    const docId = parse(uuidSchema, id);
    const { action } = parse(clientFileQuerySchema, query);
    const file = await this.repo.uploadFile(docId);
    if (!file) throw new AppError('NOT_FOUND', 'Document not found.');
    const url = await this.storage.signedDownloadUrl(file.storage_bucket, file.storage_path, FILE_URL_TTL_SECONDS, action === 'download' ? file.original_file_name : undefined, file.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: file.original_file_name };
  }

  // ---- internal sides
  openServiceRequests() { return this.repo.openServiceRequests(); }
  consultantServiceRequests(customerId: string) { return this.repo.consultantServiceRequests(parse(uuidSchema, customerId)); }
  decideServiceRequest(id: string, body: unknown) {
    const i = parse(serviceRequestDecisionSchema, body);
    return this.repo.decideServiceRequest(parse(uuidSchema, id), i.decision, i.note ?? null);
  }
  accountsPlans() { return this.repo.accountsPlans(); }
  async savePlan(id: string | null, body: unknown) {
    const i = parse(planSaveSchema, body);
    if (!id && !i.code) throw new AppError('VALIDATION_ERROR', 'Enter a plan code (for example STANDARD).');
    const planId = await this.repo.savePlan({
      id: id ? parse(uuidSchema, id) : null,
      code: i.code ?? null,
      name: i.name,
      description: i.description ?? null,
      price: i.monthlyPrice,
      features: i.features,
      services: i.services,
      active: i.isActive
    });
    return { id: planId };
  }
  decidePlanRequest(id: string, body: unknown) {
    const i = parse(planRequestDecisionSchema, body);
    return this.repo.decidePlanRequest(parse(uuidSchema, id), { decision: i.decision, note: i.note ?? null, paymentConfirmed: i.paymentConfirmed, renewsOn: i.renewsOn ?? null });
  }
  replyToClientTicket(id: string, body: unknown) {
    return this.repo.replyToClientTicket(parse(uuidSchema, id), parse(clientTicketReplySchema, body).message);
  }
}
