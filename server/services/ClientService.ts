import type { ClientDocumentUrl } from '../../shared/contracts.js';
import {
  clientDismissSchema,
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
    const { message, clientMsgId } = parse(clientTicketMessageSchema, body);
    return this.repo.sendTicketMessage(parse(uuidSchema, id), message, clientMsgId);
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
