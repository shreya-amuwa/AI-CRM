import type {
  AccountsConfirmation,
  AccountsPaymentCounts,
  ChecklistItem,
  ConsultantNote,
  Conversation,
  PartPaymentsPage,
  PaymentOverview,
  PaymentRequestItem,
  CustomerDocument,
  DocumentUploadTicket,
  DocumentUrl,
  InboundLead,
  Paginated,
  PipelineCounts,
  ReviewCounts,
  PipelineCustomer,
  PipelineCustomerDetail,
  ServiceCatalogItem
} from '../../shared/contracts.js';
import {
  accountsBackOffSchema,
  accountsConfirmReturnSchema,
  accountsQuerySchema,
  accountsRecordPaymentSchema,
  accountsUpdatePaymentSchema,
  assignPaymentOwnerSchema,
  conversationSchema,
  partPaymentsQuerySchema,
  paymentDecisionSchema,
  paymentFollowUpSchema,
  paymentReasonSchema,
  paymentRequestsQuerySchema,
  sendToAccountsSchema,
  consultantAddonsSchema,
  consultantAddonsRequiredSchema,
  consultantNoteSchema,
  consultantNoteUpdateSchema,
  consultantContractSchema,
  consultantDetailsSchema,
  checklistItemCodeSchema,
  checklistReviewSchema,
  checklistSaveSchema,
  documentUploadSchema,
  leadCreateSchema,
  leadUpdateSchema,
  moveToPotentialSchema,
  onboardingUpdateSchema,
  pipelineListQuerySchema,
  recordPaymentSchema,
  assignToMemberSchema,
  backOutSchema,
  clientAccountSchema,
  handoverNoteSchema,
  passToTeamLeadSchema,
  returnToSalesSchema,
  startOnboardingSchema,
  uuidSchema
} from '../../shared/validation.js';
import { z } from 'zod';
import type { Actor } from '../auth/authenticate.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import type { PipelineRepository } from '../repositories/PipelineRepository.js';
import { mapDocument } from '../repositories/PipelineRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

/** Signed URLs for viewing/downloading a document live this long. */
export const DOCUMENT_URL_TTL_SECONDS = 120;
const inboundIdSchema = z.string().trim().min(1).max(100);

/**
 * Sales pipeline: one customer record moves LEAD → POTENTIAL → ONBOARDING.
 * Every state change is a database function that re-checks hierarchy access
 * and writes the audit/activity trail in the same transaction.
 */
export class PipelineService {
  constructor(
    private readonly repo: PipelineRepository,
    private readonly storage: StorageRepository,
    private readonly authAdmin: AuthAdminRepository = new AuthAdminRepository()
  ) {}

  services(): Promise<ServiceCatalogItem[]> {
    return this.repo.services();
  }

  counts(): Promise<PipelineCounts> {
    return this.repo.counts();
  }

  reviewCounts(): Promise<ReviewCounts> {
    return this.repo.reviewCounts();
  }

  /** Technical Consultant authorizes every saved item at once. */
  async verifyAll(id: string): Promise<{ verified: number }> {
    return { verified: await this.repo.verifyAll(parse(uuidSchema, id)) };
  }

  async list(actor: Actor, query: unknown): Promise<Paginated<PipelineCustomer>> {
    const q = parse(pipelineListQuerySchema, query);
    return this.repo.list(q, actor.id);
  }

  async get(id: string): Promise<PipelineCustomerDetail> {
    const customerId = parse(uuidSchema, id);
    const customer = await this.repo.get(customerId);
    const [documents, documentTypes, activities, conversations, checklist] = await Promise.all([
      this.repo.documents(customerId),
      this.repo.documentTypes(),
      this.repo.activities(customerId),
      // Sales conversations are for the people who work the lead; the consultant and hand-over roles get an empty list.
      this.repo.conversations(customerId).catch(e => {
        if (e instanceof AppError && e.code === 'NOT_FOUND') return [];
        throw e;
      }),
      customer.lifecycleStage === 'ONBOARDING' || customer.lifecycleStage === 'CUSTOMER'
        ? this.repo.checklist(customerId)
        : Promise.resolve([])
    ]);
    // Technical Consultants cannot read sales profiles; give them the owner's name.
    const owner = customer.owner ?? (await this.repo.ownerSummary(customerId));
    const handover =
      customer.lifecycleStage === 'ONBOARDING' || customer.lifecycleStage === 'CUSTOMER' ? await this.repo.handoverInfo(customerId) : null;
    return { ...customer, owner, documents, documentTypes, activities, conversations, checklist, handover };
  }

  /** Sales saves a detail / yes-no / approval / access / amount / choice item. */
  async saveChecklistItem(id: string, item: string, body: unknown): Promise<void> {
    await this.repo.saveEntry(parse(uuidSchema, id), parse(checklistItemCodeSchema, item), parse(checklistSaveSchema, body).value);
  }

  /** Technical Consultant fills in one of their own items (e.g. WABA ID). */
  async saveConsultantItem(id: string, item: string, body: unknown): Promise<void> {
    await this.repo.saveConsultantEntry(parse(uuidSchema, id), parse(checklistItemCodeSchema, item), parse(checklistSaveSchema, body).value);
  }

  /** Technical Consultant verifies or rejects an item. */
  async reviewChecklistItem(id: string, item: string, body: unknown): Promise<void> {
    const input = parse(checklistReviewSchema, body);
    await this.repo.reviewEntry(parse(uuidSchema, id), parse(checklistItemCodeSchema, item), input.decision, input.note || null);
  }

  async createLead(actor: Actor, body: unknown): Promise<PipelineCustomer> {
    const input = parse(leadCreateSchema, body);
    if (actor.role === 'TEAM_MEMBER' && input.ownerId && input.ownerId !== actor.id) {
      throw new AppError('FORBIDDEN', 'You can only add leads to your own pipeline.');
    }
    if (!input.ownerId && !actor.teamId) {
      throw new AppError('VALIDATION_ERROR', 'Choose a lead owner who belongs to a team.', [{ path: 'ownerId', message: 'Required' }]);
    }
    return this.repo.get(await this.repo.createLead(input));
  }

  async updateLead(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.updateLead(customerId, parse(leadUpdateSchema, body));
    return this.repo.get(customerId);
  }

  async moveToPotential(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    const input = parse(moveToPotentialSchema, body);
    await this.repo.moveToPotential(customerId, input.dealAmount, input.paymentDueDate);
    return this.repo.get(customerId);
  }

  async recordPayment(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    const input = parse(recordPaymentSchema, body);
    await this.repo.recordPayment(customerId, input.amount, input.method);
    return this.repo.get(customerId);
  }

  /**
   * The Technical Consultant creates the client's panel login. The database checks
   * who may do it first; Supabase Auth then stores the (hashed) password.
   */
  async createClientAccount(actor: Actor, id: string, body: unknown): Promise<{ email: string }> {
    const customerId = parse(uuidSchema, id);
    const input = parse(clientAccountSchema, body);
    await this.repo.assertClientAccountAllowed(customerId, input.email);
    const userId = await this.authAdmin.createClientUser({ ...input, customerId, provisionedBy: actor.id });
    try {
      await this.repo.recordClientAccount(customerId, userId, input.email);
    } catch (e) {
      await this.authAdmin.deleteUser(userId).catch(() => undefined);
      throw e;
    }
    return { email: input.email };
  }

  async sendToDepartmentHead(id: string, body: unknown): Promise<void> {
    await this.repo.sendToDepartmentHead(parse(uuidSchema, id), parse(handoverNoteSchema, body ?? {}).note ?? null);
  }

  async passToTeamLead(id: string, body: unknown): Promise<void> {
    const input = parse(passToTeamLeadSchema, body);
    await this.repo.passToTeamLead(parse(uuidSchema, id), input.teamLeadId, input.note ?? null);
  }

  async assignToTeamMember(id: string, body: unknown): Promise<void> {
    const input = parse(assignToMemberSchema, body);
    await this.repo.assignToTeamMember(parse(uuidSchema, id), input.memberId, input.note ?? null);
  }

  /** Customer backs out at Potential: back to Leads. */
  async backOut(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.backOut(customerId, parse(backOutSchema, body ?? {}).reason ?? null);
    return this.repo.get(customerId);
  }

  async startOnboarding(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    const input = parse(startOnboardingSchema, body);
    await this.repo.startOnboarding(customerId, input.amountReceived, input.paymentMethod, input.targetHandoverDate);
    return this.repo.get(customerId);
  }

  async updateOnboarding(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.updateOnboarding(customerId, parse(onboardingUpdateSchema, body).targetHandoverDate);
    return this.repo.get(customerId);
  }

  /** Technical Consultant sends the onboarding back to sales for re-verification. */
  async returnToSales(id: string, body: unknown): Promise<void> {
    const input = parse(returnToSalesSchema, body ?? {});
    await this.repo.returnToSales(parse(uuidSchema, id), input.note || null);
  }

  /** Accounts: customers sent for amount confirmation (pending or confirmed). */
  async accountsConfirmations(query: unknown): Promise<Paginated<AccountsConfirmation>> {
    return this.repo.accountsConfirmations(parse(accountsQuerySchema, query ?? {}));
  }

  /** Accounts confirms the amount; the database then sends the customer to the Technical Consultant. */
  async confirmAccountsPayment(id: string, body: unknown): Promise<void> {
    await this.repo.confirmAccountsPayment(parse(uuidSchema, id), parse(handoverNoteSchema, body ?? {}).note ?? null);
  }

  /** Technical Consultant's Customers panel: contract yes/no, add-ons, details, "Send for onboarding". */
  async consultantSetContract(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.consultantSetContract(customerId, parse(consultantContractSchema, body).signed);
    return this.repo.get(customerId);
  }

  async consultantSetAddons(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.consultantSetAddons(customerId, parse(consultantAddonsSchema, body).addons);
    return this.repo.get(customerId);
  }

  async consultantUpdateCustomer(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.consultantUpdateCustomer(customerId, parse(consultantDetailsSchema, body));
    return this.repo.get(customerId);
  }

  /** Yes / No: the customer needs add-on services (saved selections are kept when answering No). */
  async consultantSetAddonsRequired(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.consultantSetAddonsRequired(customerId, parse(consultantAddonsRequiredSchema, body).required);
    return this.repo.get(customerId);
  }

  /** "Send to Add-ons": once, only when Yes is answered and at least one add-on is selected. */
  async consultantSendToAddons(id: string): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.consultantSendToAddons(customerId);
    return this.repo.get(customerId);
  }

  addonChecklist(id: string): Promise<ChecklistItem[]> {
    return this.repo.addonChecklist(parse(uuidSchema, id));
  }

  notesList(id: string): Promise<ConsultantNote[]> {
    return this.repo.notesList(parse(uuidSchema, id));
  }

  async noteAdd(id: string, body: unknown): Promise<ConsultantNote[]> {
    const customerId = parse(uuidSchema, id);
    const b = parse(consultantNoteSchema, body);
    await this.repo.noteAdd(customerId, b.body, b.serviceCode ?? null);
    return this.repo.notesList(customerId);
  }

  async noteUpdate(customerId: string, noteId: string, body: unknown): Promise<ConsultantNote[]> {
    const cid = parse(uuidSchema, customerId);
    await this.repo.noteUpdate(parse(uuidSchema, noteId), parse(consultantNoteUpdateSchema, body).body);
    return this.repo.notesList(cid);
  }

  async consultantStartOnboarding(id: string): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.consultantStartOnboarding(customerId);
    return this.repo.get(customerId);
  }

  async forwardToSupport(id: string): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    await this.repo.forwardToSupport(customerId);
    return this.repo.get(customerId);
  }

  async inbound(actor: Actor): Promise<InboundLead[]> {
    if (!actor.departmentId || !actor.teamId) return [];
    const slug = await this.repo.departmentSlug(actor.departmentId);
    return slug ? this.repo.inbound(slug, actor.id) : [];
  }

  async claimInbound(leadId: string): Promise<PipelineCustomer> {
    return this.repo.get(await this.repo.claimInbound(parse(inboundIdSchema, leadId)));
  }

  // ---------------------------------------------------------------------------
  // Documents. Flow: begin (DB row PENDING + signed single-path upload token) →
  // browser uploads straight to private Storage → complete (server inspects the
  // stored object, then the DB marks it UPLOADED and supersedes the old one).
  // ---------------------------------------------------------------------------
  async beginUpload(customerId: string, body: unknown): Promise<DocumentUploadTicket> {
    const id = parse(uuidSchema, customerId);
    const input = parse(documentUploadSchema, body);
    const row = await this.repo.beginUpload(id, input.documentType, input.fileName, input.mimeType, input.sizeBytes);
    try {
      const token = await this.storage.createUploadToken(row.storage_bucket, row.storage_path);
      return { document: mapDocument(row), bucket: row.storage_bucket, path: row.storage_path, token };
    } catch (err) {
      await this.repo.failUpload(row.id).catch(() => undefined);
      throw err;
    }
  }

  async completeUpload(documentId: string): Promise<CustomerDocument> {
    const id = parse(uuidSchema, documentId);
    const doc = await this.repo.pendingDocument(id);
    if (!doc) throw new AppError('NOT_FOUND', 'Document not found.');
    if (doc.status !== 'PENDING') throw new AppError('CONFLICT', 'This upload is no longer in progress.');

    const object = await this.storage.inspectFile(doc.storage_bucket, doc.storage_path, doc.mime_type);
    if (!object.exists) {
      await this.discard(id, doc.storage_bucket);
      throw new AppError('VALIDATION_ERROR', 'The file did not finish uploading. Please try again.');
    }
    if (!object.matches) {
      await this.discard(id, doc.storage_bucket);
      throw new AppError(
        'VALIDATION_ERROR',
        doc.mime_type === 'application/pdf'
          ? 'This file is not a valid PDF. Please combine the documents into one PDF and try again.'
          : 'The file content does not match its type. Please upload the original file.'
      );
    }
    try {
      await this.repo.completeUpload(id, object.size);
    } catch (err) {
      await this.discard(id, doc.storage_bucket);
      throw err;
    }
    // Old versions stay in Storage (versioned history); only metadata changes.
    this.storage.expireStaleUploads(doc.storage_bucket).catch(() => undefined);
    return this.repo.document(id);
  }

  /** Browser reports a failed/cancelled upload: mark FAILED and drop any partial object. */
  async abortUpload(documentId: string): Promise<void> {
    const id = parse(uuidSchema, documentId);
    const doc = await this.repo.pendingDocument(id);
    if (!doc) throw new AppError('NOT_FOUND', 'Document not found.');
    await this.discard(id, doc.storage_bucket);
  }

  async documentUrl(documentId: string, query: unknown): Promise<DocumentUrl> {
    const id = parse(uuidSchema, documentId);
    const { action } = parse(z.object({ action: z.enum(['view', 'download']).default('view') }), query);
    const access = await this.repo.authorizeAccess(id, action === 'download' ? 'DOWNLOAD' : 'VIEW');
    const url = await this.storage.signedDownloadUrl(
      access.storage_bucket,
      access.storage_path,
      DOCUMENT_URL_TTL_SECONDS,
      action === 'download' ? access.original_file_name : undefined
    );
    return { url, expiresInSeconds: DOCUMENT_URL_TTL_SECONDS, fileName: access.original_file_name };
  }

  async deleteDocument(documentId: string): Promise<void> {
    const id = parse(uuidSchema, documentId);
    const doc = await this.repo.pendingDocument(id);
    if (!doc) throw new AppError('NOT_FOUND', 'Document not found.');
    // Metadata first (permission + lock checks happen in the database); the
    // object is removed only after the database accepted the deletion.
    const path = await this.repo.deleteDocument(id);
    await this.storage.remove(doc.storage_bucket, [path]);
  }

  private async discard(documentId: string, bucket: string): Promise<void> {
    const path = await this.repo.failUpload(documentId);
    if (path) await this.storage.remove(bucket, [path]);
  }
  // -------------------------------------------------------------------------
  // Conversations (Sales)
  // -------------------------------------------------------------------------
  conversations(id: string): Promise<Conversation[]> {
    return this.repo.conversations(parse(uuidSchema, id));
  }

  async addConversation(id: string, body: unknown): Promise<Conversation[]> {
    const customerId = parse(uuidSchema, id);
    await this.repo.addConversation(customerId, parse(conversationSchema, body).note);
    return this.repo.conversations(customerId);
  }

  async updateConversation(id: string, body: unknown): Promise<void> {
    await this.repo.updateConversation(parse(uuidSchema, id), parse(conversationSchema, body).note);
  }

  // -------------------------------------------------------------------------
  // Sales → Accounts payment confirmation. Every check is repeated by the database.
  // -------------------------------------------------------------------------
  async sendToAccounts(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    const input = parse(sendToAccountsSchema, body);
    await this.repo.sendToAccounts(customerId, input.amount, input.note ?? null);
    return this.repo.get(customerId);
  }

  paymentOverview(id: string): Promise<PaymentOverview> {
    return this.repo.paymentOverview(parse(uuidSchema, id));
  }

  paymentRequests(query: unknown): Promise<Paginated<PaymentRequestItem>> {
    return this.repo.paymentRequests(parse(paymentRequestsQuerySchema, query ?? {}));
  }

  accountsCounts(): Promise<AccountsPaymentCounts> {
    return this.repo.accountsCounts();
  }

  accountsTeam(): Promise<{ id: string; fullName: string; role: string }[]> {
    return this.repo.accountsTeam();
  }

  async recordAccountsPayment(id: string, body: unknown): Promise<PaymentOverview> {
    const customerId = parse(uuidSchema, id);
    const input = parse(accountsRecordPaymentSchema, body);
    await this.repo.recordAccountsPayment(customerId, input);
    return this.repo.paymentOverview(customerId);
  }

  async updateAccountsPayment(paymentId: string, customerId: string, body: unknown): Promise<PaymentOverview> {
    await this.repo.updateAccountsPayment(parse(uuidSchema, paymentId), parse(accountsUpdatePaymentSchema, body));
    return this.repo.paymentOverview(parse(uuidSchema, customerId));
  }

  async verifyAccountsPayment(paymentId: string, customerId: string, body: unknown): Promise<PaymentOverview> {
    await this.repo.verifyAccountsPayment(parse(uuidSchema, paymentId), parse(paymentDecisionSchema, body ?? {}).note ?? null);
    return this.repo.paymentOverview(parse(uuidSchema, customerId));
  }

  async rejectAccountsPayment(paymentId: string, customerId: string, body: unknown): Promise<PaymentOverview> {
    await this.repo.rejectAccountsPayment(parse(uuidSchema, paymentId), parse(paymentReasonSchema, body).reason);
    return this.repo.paymentOverview(parse(uuidSchema, customerId));
  }

  async reverseAccountsPayment(paymentId: string, customerId: string, body: unknown): Promise<PaymentOverview> {
    await this.repo.reverseAccountsPayment(parse(uuidSchema, paymentId), parse(paymentReasonSchema, body).reason);
    return this.repo.paymentOverview(parse(uuidSchema, customerId));
  }

  /** "Confirm payment & return to Sales": the customer moves to Customer onboarding. */
  async confirmAndReturn(id: string, body: unknown): Promise<void> {
    await this.repo.confirmAndReturn(parse(uuidSchema, id), parse(accountsConfirmReturnSchema, body ?? {}).note ?? null);
  }

  /** "Customer backed off": the customer returns to My Leads → Leads. */
  async returnToLeads(id: string, body: unknown): Promise<void> {
    await this.repo.returnToLeads(parse(uuidSchema, id), parse(accountsBackOffSchema, body ?? {}).reason ?? null);
  }

  async assignPaymentOwner(id: string, body: unknown): Promise<PaymentOverview> {
    const customerId = parse(uuidSchema, id);
    await this.repo.assignPaymentOwner(customerId, parse(assignPaymentOwnerSchema, body).ownerId);
    return this.repo.paymentOverview(customerId);
  }

  async addPaymentFollowUp(id: string, body: unknown): Promise<PaymentOverview> {
    const customerId = parse(uuidSchema, id);
    const input = parse(paymentFollowUpSchema, body);
    await this.repo.addPaymentFollowUp(customerId, input.outcome, input.note, input.nextFollowUpAt ?? null);
    return this.repo.paymentOverview(customerId);
  }

  partPayments(query: unknown): Promise<PartPaymentsPage> {
    return this.repo.partPayments(parse(partPaymentsQuerySchema, query ?? {}));
  }
}
