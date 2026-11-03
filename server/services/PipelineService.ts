import { accountsCustomerDetailsSchema } from '../../shared/validation.js';
import type {
  ClientLoginOutcome,
  CustomerJourneyInfo,
  CustomerJourneyStatus,
  ExistingBlueTick,
  MetaOutcomeResult,
  SubscriptionList,
  SubscriptionOverview,
  DeliveryQueueItem,
  ServiceJourneySetting,
  DivisionLeadsOverview,
  DivisionSupportOverview,
  ClientMessages,
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
  ProvisioningQueue,
  PipelineCounts,
  ReviewCounts,
  PipelineCustomer,
  OnboardingHandoffInfo,
  PipelineCustomerDetail,
  ServiceCatalogItem
} from '../../shared/contracts.js';
import {
  accountsBackOffSchema,
  accountsClientLoginSchema,
  customerEmailCorrectionSchema,
  provisioningQuerySchema,
  deliveryQueueQuerySchema,
  sendToDeliverySchema,
  serviceJourneySchema,
  accountsConfirmReturnSchema,
  accountsQuerySchema,
  accountsRecordPaymentSchema,
  accountsUpdatePaymentSchema,
  orderGstSchema,
  assignPaymentOwnerSchema,
  conversationSchema,
  partPaymentsQuerySchema,
  paymentDecisionSchema,
  paymentFollowUpSchema,
  paymentReasonSchema,
  paymentRequestsQuerySchema,
  sendToAccountsSchema,
  consultantAddonsRequiredSchema,
  consultantNoteSchema,
  consultantNoteUpdateSchema,
  consultantContractSchema,
  consultantDetailsSchema,
  checklistItemCodeSchema,
  checklistReviewSchema,
  checklistSaveSchema,
  documentUploadSchema,
  addonInvoiceUploadSchema,
  invoiceReplaceSchema,
  invoiceUploadSchema,
  leadCreateSchema,
  leadUpdateSchema,
  moveToPotentialSchema,
  onboardingUpdateSchema,
  divisionOverviewQuerySchema,
  pipelineListQuerySchema,
  recordPaymentSchema,
  assignToMemberSchema,
  backOutSchema,
  metaVerificationSchema,
  metaOutcomeSchema,
  existingBlueTickSchema,
  journeyVerifierSchema,
  subscriptionActivationSchema,
  subscriptionListQuerySchema,
  subscriptionCorrectionSchema,
  subscriptionRenewalSchema,
  subscriptionTermsSchema,
  serviceSetupSchema,
  consultantWebsiteSchema,
  handoverNoteSchema,
  passToTeamLeadSchema,
  returnToSalesSchema,
  startOnboardingSchema,
  uuidSchema
} from '../../shared/validation.js';
import { z } from 'zod';
import type { Actor } from '../auth/authenticate.js';
import { AppError } from '../http/errors.js';
import { hasServiceClient } from '../db/supabase.js';
import { parse } from '../http/validate.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import { automationSettings, liveChannels } from '../automations/config.js';
import { randomBytes } from 'node:crypto';
import { encryptSecret, temporaryPassword } from '../automations/secrets.js';
import type { PipelineRepository } from '../repositories/PipelineRepository.js';
import { mapDocument } from '../repositories/PipelineRepository.js';
import type { StorageProviderName, StorageRepository } from '../repositories/StorageRepository.js';
import { assertCanDeleteCustomers } from '../authz/policies.js';

/** Signed URLs for viewing/downloading a document live this long. */
export const DOCUMENT_URL_TTL_SECONDS = 120;
const inboundIdSchema = z.string().trim().min(1).max(100);

/**
 * Sales pipeline: one customer record moves LEAD → POTENTIAL → ONBOARDING.
 * Every state change is a database function that re-checks hierarchy access
 * and writes the audit/activity trail in the same transaction.
 */
const serviceCodeParam = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.');

export class PipelineService {
  constructor(
    private readonly repo: PipelineRepository,
    private readonly storage: StorageRepository,
    private readonly authAdmin: AuthAdminRepository = new AuthAdminRepository()
  ) {}

  services(): Promise<ServiceCatalogItem[]> {
    return this.repo.services();
  }

  divisionOverview(query: unknown): Promise<DivisionLeadsOverview> {
    const q = parse(divisionOverviewQuerySchema, query);
    return this.repo.divisionOverview(q.departmentId, q.division);
  }

  divisionSupportOverview(query: unknown): Promise<DivisionSupportOverview> {
    const q = parse(divisionOverviewQuerySchema, query);
    return this.repo.divisionSupportOverview(q.departmentId, q.division);
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
    const customerId = await this.repo.createLead(input);
    // the plan, duration, amount and credits chosen for each service (validated above: there is no date in them)
    for (const { service, ...terms } of input.subscriptions ?? []) {
      await this.repo.setSubscriptionTerms(customerId, service, this.termsPayload(terms));
    }
    return this.repo.get(customerId);
  }

  private termsPayload(t: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) if (v !== undefined && v !== null) out[k] = v;
    return out;
  }

  async updateLead(id: string, body: unknown): Promise<PipelineCustomer> {
    const customerId = parse(uuidSchema, id);
    const input = parse(leadUpdateSchema, body);
    await this.repo.updateLead(customerId, input);
    for (const { service, ...terms } of input.subscriptions ?? []) {
      await this.repo.setSubscriptionTerms(customerId, service, this.termsPayload(terms));
    }
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
   * Accounts creates the client's dashboard login, for every service. The database checks who may and when (a verified payment), refuses a
   * second click while one is running, and returns the e-mail ON THE CUSTOMER RECORD - the request carries none, so a screen can never
   * substitute another address. Two ways in (the request's `method`):
   *  - LINK (default): the login gets a random password nobody knows; the client chooses their own from the one-time link in the e-mail.
   *  - TEMPORARY: the SERVER makes a random temporary password, creates the login with it and queues ONE e-mail carrying it (encrypted on
   *    the job, erased by the database once the job is done). The browser never sees it. The client must choose their own at the first
   *    sign-in; until then every client function is refused. Needs AUTOMATION_SECRET_KEY, otherwise it is refused before anything is made.
   * The e-mail is queued only after the login is saved. A failure is recorded on the customer with a safe reason and the attempt can be
   * repeated; a half-made login (created, not saved) is removed - or, if that is not possible, finished by the retry - so no customer ever
   * has two.
   */
  async accountsCreateClientLogin(actor: Actor, id: string, body: unknown): Promise<{ email: string; status: 'CREATED'; method: 'LINK' | 'TEMPORARY' }> {
    const customerId = parse(uuidSchema, id);
    const { method } = parse(accountsClientLoginSchema, body ?? {});
    const key = automationSettings().secretKey;
    if (method === 'TEMPORARY' && !key) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Temporary passwords need AUTOMATION_SECRET_KEY on the server. Use the set-password link, or ask your administrator to set it.');
    }
    const target = await this.repo.accountsClientLoginBegin(customerId, method);
    const temporary = method === 'TEMPORARY' ? temporaryPassword() : null;
    let userId: string | null = null;
    let created = false;
    try {
      userId = await this.authAdmin.clientUserFor(customerId, target.email);
      if (!userId) {
        userId = await this.authAdmin.createClientUser({
          email: target.email,
          password: temporary ?? randomBytes(32).toString('base64url'),
          customerId,
          provisionedBy: actor.id
        });
        created = true;
      } else if (temporary) {
        // an earlier, interrupted attempt made the sign-in; its temporary password is lost, so this attempt's replaces it
        await this.authAdmin.setClientPassword(userId, temporary);
      }
      await this.repo.recordClientAccount(customerId, userId, target.email, temporary ? encryptSecret(temporary, key!) : null);
    } catch (e) {
      if (userId && created) await this.authAdmin.deleteUser(userId).catch(() => undefined);
      const message = e instanceof AppError ? e.message : 'The login could not be created.';
      await this.repo.accountsClientLoginFailed(customerId, message).catch(() => undefined);
      throw e;
    }
    return { email: target.email, status: 'CREATED', method };
  }

  /** Accounts: customers with a verified payment and the state of their login (customer, ID, order, e-mail, status, time, result). */
  provisioningQueue(query: unknown): Promise<ProvisioningQueue> {
    return this.repo.accountsProvisioningQueue(parse(provisioningQuerySchema, query ?? {}));
  }

  /** Accounts: correct a missing or wrong e-mail on the record before the login is made (reason required, audited). */
  async accountsCustomerDetails(id: string, body?: unknown) {
    return this.repo.accountsCustomerDetails(parse(uuidSchema, id), body === undefined ? null : parse(accountsCustomerDetailsSchema, body));
  }

  async correctCustomerEmail(id: string, body: unknown): Promise<void> {
    const customerId = parse(uuidSchema, id);
    const input = parse(customerEmailCorrectionSchema, body);
    await this.repo.accountsSetCustomerEmail(customerId, input.email, input.reason);
  }

  /**
   * Accounts: send the account e-mail again (a failed one is retried, a delivered one at most every 10 minutes). If the client has not yet
   * chosen their own password after a temporary one, a NEW temporary password is made and put on the login first (the old one is gone - it
   * was never stored); otherwise the set-password link is sent. An existing password is never reset for a client who chose their own.
   */
  async resendAccountEmail(id: string): Promise<void> {
    const customerId = parse(uuidSchema, id);
    const state = await this.repo.accountsClientAccountState(customerId);
    if (state.exists && state.accessMethod === 'TEMPORARY' && state.mustChangePassword && state.authUserId) {
      const key = automationSettings().secretKey;
      if (!key) {
        throw new AppError('SERVICE_UNAVAILABLE', 'Temporary passwords need AUTOMATION_SECRET_KEY on the server.');
      }
      const temporary = temporaryPassword();
      // the database refuses (and nothing changes) when an e-mail is on its way or was sent a moment ago: so ask it first with the new secret
      // and only then change the password, in that order, so a refused resend never invalidates the password the client already holds
      await this.repo.accountsResendAccountEmail(customerId, encryptSecret(temporary, key));
      await this.authAdmin.setClientPassword(state.authUserId, temporary);
      return;
    }
    await this.repo.accountsResendAccountEmail(customerId);
  }

  /** Meta has completed the verification: the "completed" message is queued, once. */
  async markMetaVerificationCompleted(id: string): Promise<void> {
    await this.repo.markMetaVerificationCompleted(parse(uuidSchema, id));
  }

  /** Where a customer is: its journey, login, documents and delivery state, and what the caller may do next. */
  customerJourney(id: string): Promise<CustomerJourneyInfo> {
    return this.repo.customerJourney(parse(uuidSchema, id));
  }

  /** Sales / Support: send the verified services to the department that delivers them (each service to its own). */
  async sendToDelivery(id: string, body: unknown): Promise<{ sent: number; remaining: number; departments: string | null }> {
    return this.repo.sendToDelivery(parse(uuidSchema, id), parse(sendToDeliverySchema, body ?? {}).note ?? null);
  }

  /** A delivery department: what it was sent. */
  deliveryQueue(query: unknown): Promise<Paginated<DeliveryQueueItem>> {
    return this.repo.deliveryQueue(parse(deliveryQueueQuerySchema, query ?? {}));
  }

  serviceJourneys(): Promise<ServiceJourneySetting[]> {
    return this.repo.serviceJourneys();
  }

  /** Super Admin: whether a service needs a Technical Consultant, and which department delivers it otherwise. */
  async setServiceJourney(code: string, body: unknown): Promise<ServiceJourneySetting[]> {
    const service = parse(z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.'), code);
    const input = parse(serviceJourneySchema, body);
    await this.repo.setServiceJourney(service, input.requiresTechnicalConsultant, input.deliveryDepartmentId ?? null);
    return this.repo.serviceJourneys();
  }

  /** The Technical Consultant saves (or corrects) the customer's website link. */
  async consultantSetWebsite(id: string, body: unknown): Promise<{ website: string }> {
    const input = parse(consultantWebsiteSchema, body);
    return { website: await this.repo.consultantSetWebsite(parse(uuidSchema, id), input.url) };
  }

  /** Queues the messages of the customer's current step again (they are sent right after this request). */
  async resendClientMessages(id: string): Promise<{ stage: string; queued: number }> {
    return this.repo.resendClientMessages(parse(uuidSchema, id));
  }

  /** Onboarding emails / WhatsApp messages of a customer, with the current stage. */
  async clientMessages(id: string): Promise<ClientMessages> {
    const { info, rows } = await this.repo.clientMessages(parse(uuidSchema, id));
    const s = automationSettings();
    return {
      automated: !!info?.automated,
      stage: info?.stage ?? null,
      stageChangedAt: info?.stageChangedAt ?? null,
      mode: s.mode,
      testMode: s.mode === 'live' && !!s.testRecipients,
      emailReady: liveChannels(s).includes('EMAIL'),
      whatsappReady: liveChannels(s).includes('WHATSAPP'),
      messages: rows.map(r => ({
        id: r.id,
        channel: r.channel,
        stage: r.stage,
        status: r.status,
        detail: r.detail ?? null,
        attempts: r.attempts,
        recipient: r.recipient ?? null,
        createdAt: r.created_at,
        sentAt: r.sent_at ?? null,
        nextAttemptAt: r.next_attempt_at
      }))
    };
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

  async handoffInfo(id: string): Promise<OnboardingHandoffInfo> {
    return this.repo.handoffInfo(parse(uuidSchema, id));
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
    return this.ticket(await this.repo.beginUpload(id, input.documentType, input.fileName, input.mimeType, input.sizeBytes));
  }

  /** The single signed upload path for a PENDING row; the row is failed if storage cannot issue it. */
  private async ticket(row: any): Promise<DocumentUploadTicket> {
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
      await this.repo.failUpload(row.id).catch(() => undefined);
      throw err;
    }
  }

  // Invoice PDFs (Accounts only; the database checks the role, the customer, the number and the size again).
  async beginInvoiceUpload(body: unknown): Promise<DocumentUploadTicket> {
    return this.ticket(await this.repo.beginInvoiceUpload(parse(invoiceUploadSchema, body)));
  }

  /** The invoice PDF of an approved add-on request (its total always comes from the approved request). */
  async beginAddonInvoiceUpload(requestId: string, body: unknown): Promise<DocumentUploadTicket> {
    return this.ticket(await this.repo.beginAddonInvoiceUpload(parse(uuidSchema, requestId), parse(addonInvoiceUploadSchema, body)));
  }

  async beginInvoiceReplacement(invoiceId: string, body: unknown): Promise<DocumentUploadTicket> {
    const input = parse(invoiceReplaceSchema, body);
    return this.ticket(await this.repo.beginInvoiceReplacement(parse(uuidSchema, invoiceId), input.fileName, input.mimeType, input.sizeBytes));
  }

  /** Same checks as any document (stored object, PDF signature, size), then the invoice as it now stands. */
  async completeInvoiceUpload(documentId: string): Promise<unknown> {
    const doc = await this.completeUpload(documentId);
    if (!doc.invoiceId) throw new AppError('CONFLICT', 'This file is not an invoice.');
    return this.repo.invoiceDetail(doc.invoiceId);
  }

  invoiceDetail(invoiceId: string): Promise<unknown> {
    return this.repo.invoiceDetail(parse(uuidSchema, invoiceId));
  }

  async completeUpload(documentId: string): Promise<CustomerDocument> {
    const id = parse(uuidSchema, documentId);
    const doc = await this.repo.pendingDocument(id);
    if (!doc) throw new AppError('NOT_FOUND', 'Document not found.');
    if (doc.status !== 'PENDING') throw new AppError('CONFLICT', 'This upload is no longer in progress.');

    const object = await this.storage.inspectFile(doc.storage_provider, doc.storage_bucket, doc.storage_path, doc.mime_type);
    if (!object.exists) {
      await this.discard(id, doc.storage_bucket, doc.storage_provider);
      throw new AppError('VALIDATION_ERROR', 'The file did not finish uploading. Please try again.');
    }
    if (!object.matches) {
      await this.discard(id, doc.storage_bucket, doc.storage_provider);
      throw new AppError(
        'VALIDATION_ERROR',
        doc.mime_type === 'application/pdf'
          ? doc.document_type === 'INVOICE'
            ? 'This file is not a valid PDF. Please upload the original invoice PDF.'
            : 'This file is not a valid PDF. Please combine the documents into one PDF and try again.'
          : 'The file content does not match its type. Please upload the original file.'
      );
    }
    try {
      await this.repo.completeUpload(id, object.size);
    } catch (err) {
      await this.discard(id, doc.storage_bucket, doc.storage_provider);
      throw err;
    }
    // The stored file's reference (provider, key, ETag) is kept in Supabase next to the document.
    await this.storage.recordStored(id, doc.storage_provider, { reference: object.reference, etag: object.etag });
    // Old versions stay in Storage (versioned history); only metadata changes.
    this.storage.expireStaleUploads(doc.storage_bucket).catch(() => undefined);
    return this.repo.document(id);
  }

  /** Browser reports a failed/cancelled upload: mark FAILED and drop any partial object. */
  async abortUpload(documentId: string): Promise<void> {
    const id = parse(uuidSchema, documentId);
    const doc = await this.repo.pendingDocument(id);
    if (!doc) throw new AppError('NOT_FOUND', 'Document not found.');
    await this.discard(id, doc.storage_bucket, doc.storage_provider);
  }

  async documentUrl(documentId: string, query: unknown): Promise<DocumentUrl> {
    const id = parse(uuidSchema, documentId);
    const { action } = parse(z.object({ action: z.enum(['view', 'download']).default('view') }), query);
    const access = await this.repo.authorizeAccess(id, action === 'download' ? 'DOWNLOAD' : 'VIEW');
    const url = await this.storage.signedDownloadUrl(
      access.storage_bucket,
      access.storage_path,
      DOCUMENT_URL_TTL_SECONDS,
      action === 'download' ? access.original_file_name : undefined,
      await this.repo.providerOf(id)
    );
    return { url, expiresInSeconds: DOCUMENT_URL_TTL_SECONDS, fileName: access.original_file_name };
  }

  /**
   * Deletes a customer. The database checks who may and refuses a customer with an issued invoice or a verified payment; only after it
   * accepted the deletion are the stored files and the client's sign-in user removed (a failure there never undoes the deletion).
   */
  async deleteCustomer(actor: Actor, customerId: string): Promise<{ name: string }> {
    assertCanDeleteCustomers(actor);
    const r = await this.repo.deleteCustomer(parse(uuidSchema, customerId));
    const byBucket = new Map<string, { provider: StorageProviderName | null; paths: string[] }>();
    for (const d of r.documents) {
      const key = `${d.provider ?? ''}|${d.bucket}`;
      const e = byBucket.get(key) ?? { provider: d.provider, paths: [] };
      e.paths.push(d.path);
      byBucket.set(key, e);
    }
    for (const [key, e] of byBucket) await this.storage.remove(key.split('|')[1], e.paths, e.provider).catch(() => undefined);
    if (r.clientUserId) await this.authAdmin.deleteUser(r.clientUserId).catch(() => undefined);
    return { name: r.name };
  }

  async deleteDocument(documentId: string): Promise<void> {
    const id = parse(uuidSchema, documentId);
    const doc = await this.repo.pendingDocument(id);
    if (!doc) throw new AppError('NOT_FOUND', 'Document not found.');
    // Metadata first (permission + lock checks happen in the database); the
    // object is removed only after the database accepted the deletion.
    const path = await this.repo.deleteDocument(id);
    await this.storage.remove(doc.storage_bucket, [path], doc.storage_provider);
  }

  private async discard(documentId: string, bucket: string, provider?: StorageProviderName | null): Promise<void> {
    const path = await this.repo.failUpload(documentId);
    if (path) await this.storage.remove(bucket, [path], provider);
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
    await this.repo.sendToAccounts(customerId, input.amount, input.note ?? null, input.taxBasis);
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
    return (await this.recordAccountsPaymentTracked(id, body)).overview;
  }

  /** Records the payment and says which one it is and what Accounts asked for, so the paid invoice of a verified payment can follow. */
  async recordAccountsPaymentTracked(id: string, body: unknown): Promise<{ overview: PaymentOverview; paymentId: string; makeInvoice: boolean }> {
    const customerId = parse(uuidSchema, id);
    const input = parse(accountsRecordPaymentSchema, body);
    const paymentId = await this.repo.recordAccountsPayment(customerId, input);
    return { overview: await this.repo.paymentOverview(customerId), paymentId, makeInvoice: input.verify && input.invoice };
  }

  /** Accounts chooses the GST rate of the order; the overview (with the new total payable) comes back. */
  async setOrderGst(id: string, body: unknown): Promise<PaymentOverview> {
    const customerId = parse(uuidSchema, id);
    await this.repo.setOrderGst(customerId, parse(orderGstSchema, body).rate);
    return this.repo.paymentOverview(customerId);
  }

  gstReconciliation() {
    return this.repo.gstReconciliation();
  }

  async updateAccountsPayment(paymentId: string, customerId: string, body: unknown): Promise<PaymentOverview> {
    await this.repo.updateAccountsPayment(parse(uuidSchema, paymentId), parse(accountsUpdatePaymentSchema, body));
    return this.repo.paymentOverview(parse(uuidSchema, customerId));
  }

  async verifyAccountsPayment(paymentId: string, customerId: string, body: unknown): Promise<PaymentOverview> {
    return (await this.verifyAccountsPaymentTracked(paymentId, customerId, body)).overview;
  }

  async verifyAccountsPaymentTracked(paymentId: string, customerId: string, body: unknown): Promise<{ overview: PaymentOverview; makeInvoice: boolean }> {
    const input = parse(paymentDecisionSchema, body ?? {});
    await this.repo.verifyAccountsPayment(parse(uuidSchema, paymentId), input.note ?? null);
    return { overview: await this.repo.paymentOverview(parse(uuidSchema, customerId)), makeInvoice: input.invoice };
  }

  paymentOverviewOf(customerId: string): Promise<PaymentOverview> {
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

  /**
   * "Confirm payment & return to Sales": the customer moves to Customer onboarding and the client's dashboard login is made right away by
   * the same secure flow Accounts uses from Client Logins (accountsCreateClientLogin: the e-mail on the customer record, a random password
   * nobody knows, a one-time set-password link e-mailed through the outbox). Nothing is unlocked by it: the dashboard shows the onboarding
   * journey and opens the other sections stage by stage (the database decides). Making the login never fails the confirmation: when it
   * cannot be made the reason is returned and Accounts can create it from Client Logins.
   * By default NOTHING is made or e-mailed here: the client's login (and its "set your password" e-mail) is created when Accounts does it
   * from Client Logins (or the journey's "Create login" step). Set AUTO_CLIENT_LOGIN=on to make it at confirmation as well.
   */
  async confirmAndReturn(actor: Actor, id: string, body: unknown): Promise<ClientLoginOutcome> {
    const customerId = parse(uuidSchema, id);
    await this.repo.confirmAndReturn(customerId, parse(accountsConfirmReturnSchema, body ?? {}).note ?? null);
    return this.provisionLoginAfterPayment(actor, customerId);
  }

  private async provisionLoginAfterPayment(actor: Actor, customerId: string): Promise<ClientLoginOutcome> {
    if (process.env.AUTO_CLIENT_LOGIN !== 'on') return { status: 'LATER' };
    if (!hasServiceClient()) {
      return { status: 'NOT_CREATED', detail: 'Client logins are not created automatically on this server. Create it from Client Logins.' };
    }
    try {
      const r = await this.accountsCreateClientLogin(actor, customerId, {});
      return { status: 'CREATED', email: r.email };
    } catch (e) {
      const message = e instanceof AppError ? e.message : 'The client login could not be created. Create it from Client Logins.';
      // a login that already exists is not a problem; anything else is shown to Accounts, who can retry from Client Logins
      return { status: /already has a login/i.test(message) ? 'EXISTS' : 'NOT_CREATED', ...(/already has a login/i.test(message) ? {} : { detail: message }) };
    }
  }

  // ---- subscriptions ----
  /** The signed-in employee's customers' subscriptions (read only; the database applies the same scope as the customer pages). */
  subscriptionsList(query: unknown): Promise<SubscriptionList> {
    return this.repo.subscriptionsList(parse(subscriptionListQuerySchema, query ?? {}));
  }

  subscriptionOverview(id: string): Promise<SubscriptionOverview> {
    return this.repo.subscriptionOverview(parse(uuidSchema, id));
  }

  /** Sales: the plan, duration, amount and credits of one service. The body has no date field: one is refused. */
  async setSubscriptionTerms(id: string, code: string, body: unknown): Promise<SubscriptionOverview> {
    const customerId = parse(uuidSchema, id);
    await this.repo.setSubscriptionTerms(customerId, parse(serviceCodeParam, code), this.termsPayload(parse(subscriptionTermsSchema, body)));
    return this.repo.subscriptionOverview(customerId);
  }

  /** The team: the panel was created and activated, on this date. The database calculates the expiry; a repeated request changes nothing. */
  async confirmSubscriptionActivation(id: string, code: string, body: unknown): Promise<SubscriptionOverview> {
    const customerId = parse(uuidSchema, id);
    const input = parse(subscriptionActivationSchema, body);
    await this.repo.confirmSubscriptionActivation(customerId, parse(serviceCodeParam, code), input.activationDate, input.panelCreatedOn ?? null, input.note ?? null);
    // (the activation e-mail the database queued is sent right after this request by the pipeline hook; a failure never undoes the activation and can be retried)
    return this.repo.subscriptionOverview(customerId);
  }

  async correctSubscriptionDates(id: string, code: string, body: unknown): Promise<SubscriptionOverview> {
    const customerId = parse(uuidSchema, id);
    const input = parse(subscriptionCorrectionSchema, body);
    await this.repo.correctSubscriptionDates(customerId, parse(serviceCodeParam, code), input.activationDate, input.panelCreatedOn ?? null, input.reason);
    return this.repo.subscriptionOverview(customerId);
  }

  async confirmSubscriptionRenewal(id: string, code: string, body: unknown): Promise<SubscriptionOverview> {
    const customerId = parse(uuidSchema, id);
    const input = parse(subscriptionRenewalSchema, body);
    await this.repo.confirmSubscriptionRenewal(customerId, parse(serviceCodeParam, code), input.paymentId, input.startDate ?? null,
      input.terms ? this.termsPayload(input.terms) : null, input.note ?? null);
    return this.repo.subscriptionOverview(customerId);
  }

  async resendActivationEmail(id: string, code: string): Promise<SubscriptionOverview> {
    const customerId = parse(uuidSchema, id);
    await this.repo.resendActivationEmail(customerId, parse(serviceCodeParam, code));
    return this.repo.subscriptionOverview(customerId);
  }

  // ---- onboarding journey: Meta verification, the Meta Verifier, service setup ----
  journeyStatus(id: string): Promise<CustomerJourneyStatus> {
    return this.repo.journeyStatus(parse(uuidSchema, id));
  }

  /** The Technical Consultant sets the Meta verification status (the database checks who may and which moves are allowed). */
  async setMetaVerification(id: string, body: unknown): Promise<CustomerJourneyStatus> {
    const customerId = parse(uuidSchema, id);
    const input = parse(metaVerificationSchema, body);
    await this.repo.setMetaVerification(customerId, input.status, input.feedback ?? null);
    return this.repo.journeyStatus(customerId);
  }

  existingBlueTick(id: string): Promise<ExistingBlueTick> {
    return this.repo.existingBlueTick(parse(uuidSchema, id));
  }

  /** A customer who already holds a Blue Tick and bought WhatsApp API only. Recording it never changes the sale or the badge. */
  async setExistingBlueTick(id: string, body: unknown): Promise<ExistingBlueTick> {
    const input = parse(existingBlueTickSchema, body);
    return this.repo.setExistingBlueTick(parse(uuidSchema, id), input.status, input.reference ?? null, input.note ?? null);
  }

  /** The Meta decision, once per event key. The database repeats every check (who may, which moves are allowed, the evidence). */
  async recordMetaOutcome(id: string, body: unknown): Promise<MetaOutcomeResult> {
    const input = parse(metaOutcomeSchema, body);
    return this.repo.recordMetaOutcome(parse(uuidSchema, id), input.outcome, input.eventKey, input.reference ?? null, input.note ?? null);
  }

  /** A Technical Consultant takes the verification (no verifier given) or a head names one. */
  async assignMetaVerifier(id: string, body: unknown): Promise<CustomerJourneyStatus> {
    const customerId = parse(uuidSchema, id);
    await this.repo.assignMetaVerifier(customerId, parse(journeyVerifierSchema, body ?? {}).verifierId ?? null);
    return this.repo.journeyStatus(customerId);
  }

  metaVerifierCandidates(id: string): Promise<{ id: string; fullName: string }[]> {
    return this.repo.metaVerifierCandidates(parse(uuidSchema, id));
  }

  /** The responsible team starts or finishes the setup of one purchased service (the database checks the prerequisites). */
  async setServiceSetup(id: string, code: string, body: unknown): Promise<CustomerJourneyStatus> {
    const customerId = parse(uuidSchema, id);
    const service = parse(z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.'), code);
    const input = parse(serviceSetupSchema, body);
    await this.repo.setServiceSetup(customerId, service, input.status, input.note ?? null);
    return this.repo.journeyStatus(customerId);
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
