import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccountsPlans,
  ClientActivityInput,
  ClientActivityList,
  ClientAnnouncement,
  ClientCalendarEvent,
  ClientCampaign,
  ClientCatalogService,
  ClientDocumentQueueItem,
  ClientDocuments,
  ClientInvoice,
  ClientJourney,
  ClientSubscription,
  ClientNotifications,
  ClientOverview,
  ClientPlans,
  ClientProfile,
  ClientBilling,
  ClientService,
  ClientServiceProgress,
  ClientServiceRequest,
  ClientTicket,
  ClientTicketDetail,
  ConsultantOpenServiceRequest,
  ConsultantServiceRequest
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/**
 * Everything the client dashboard reads or does. Each call is a database function that works out WHO the
 * client is from their own login (no customer id is ever sent), so one client cannot reach another's data.
 */
export class ClientRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  me() { return this.rpc<ClientProfile>('client_me'); }
  overview() { return this.rpc<ClientOverview>('client_overview'); }
  /** Where the client is in the onboarding journey, and which sections are open (worked out by the database from the stored records). */
  journey() { return this.rpc<ClientJourney>('client_onboarding_journey'); }

  /** The subscription of each service: plan, duration, status, panel and start / expiry dates (empty until the panel is activated) and message usage. */
  subscriptions() { return this.rpc<ClientSubscription[]>('client_subscriptions'); }
  services() { return this.rpc<ClientService[]>('client_services'); }
  billing() { return this.rpc<ClientBilling>('client_billing'); }
  serviceProgress() { return this.rpc<ClientServiceProgress[]>('client_service_progress'); }
  campaigns() { return this.rpc<ClientCampaign[]>('client_campaigns'); }
  catalog() { return this.rpc<ClientCatalogService[]>('client_service_catalog'); }
  serviceRequests() { return this.rpc<ClientServiceRequest[]>('client_service_requests'); }
  requestService(serviceCode: string, note: string | null) {
    return this.rpc<{ id: string; status: string; serviceCode: string; serviceName: string }>('client_request_service', { p_service: serviceCode, p_note: note });
  }
  async cancelServiceRequest(id: string): Promise<void> { await this.rpc('client_cancel_service_request', { p_request: id }); }

  plans() { return this.rpc<ClientPlans>('client_plans'); }
  requestPlan(planId: string, note: string | null) {
    return this.rpc<{ id: string; status: string; kind: string; planName: string }>('client_request_plan', { p_plan: planId, p_note: note });
  }

  invoices() { return this.rpc<ClientInvoice[]>('client_invoices'); }
  /** Where the file of one of MY invoices lives (uploaded or generated; a generated invoice offers its paid file only once it is stored). */
  async invoiceFile(id: string) {
    const rows = await this.rpc<{ storage_provider: 'SUPABASE' | 'R2'; storage_bucket: string; storage_path: string; original_file_name: string; mime_type: string }[]>('client_invoice_download', { p_invoice: id });
    return rows[0];
  }

  tickets() { return this.rpc<ClientTicket[]>('client_tickets'); }
  ticket(id: string) { return this.rpc<ClientTicketDetail>('client_ticket', { p_ticket: id }); }
  createTicket(i: { subject: string; description: string; category: string; serviceCode: string | null; attachmentIds: string[] }) {
    return this.rpc<ClientTicket>('client_create_ticket', { p_subject: i.subject, p_description: i.description, p_category: i.category, p_service: i.serviceCode, p_attachments: i.attachmentIds });
  }
  replyTicket(id: string, message: string) { return this.rpc<ClientTicketDetail>('client_reply_ticket', { p_ticket: id, p_message: message }); }
  sendTicketMessage(id: string, message: string, clientMsgId: string | null, attachmentIds: string[]) {
    return this.rpc<ClientTicketDetail>('client_send_ticket_message', { p_ticket: id, p_message: message, p_client_msg_id: clientMsgId, p_attachments: attachmentIds });
  }
  ticketSeen(id: string) { return this.rpc<number>('client_ticket_seen', { p_ticket: id }); }

  announcements() { return this.rpc<ClientAnnouncement[]>('client_announcements'); }
  async dismissAnnouncement(id: string, occurrence: string): Promise<void> { await this.rpc('client_dismiss_announcement', { p_id: id, p_occurrence: occurrence }); }

  notifications(limit: number, offset: number) { return this.rpc<ClientNotifications>('client_notifications', { p_limit: limit, p_offset: offset }); }
  markRead(ids: string[] | null) { return this.rpc<number>('client_mark_notifications_read', { p_ids: ids }); }

  // ---- calendar and documents (the client)
  calendar(from: string, to: string) { return this.rpc<ClientCalendarEvent[]>('client_calendar', { p_from: from, p_to: to }); }
  documents() { return this.rpc<ClientDocuments>('client_documents'); }
  beginDocumentUpload(item: string, fileName: string, mime: string, size: number) {
    return this.rpc<any>('client_begin_document_upload', { p_item: item, p_file_name: fileName, p_mime: mime, p_size: size });
  }
  pendingDocument(id: string) { return this.rpc<any>('client_pending_document', { p_document: id }); }
  completeDocumentUpload(id: string, size: number) { return this.rpc<any>('client_complete_document_upload', { p_document: id, p_size: size }); }
  async abortDocumentUpload(id: string): Promise<void> { await this.rpc('client_abort_document_upload', { p_document: id }); }
  async saveDetail(item: string, value: string): Promise<void> { await this.rpc('client_save_detail', { p_item: item, p_value: value }); }
  async documentFile(id: string) {
    const rows = await this.rpc<{ storage_provider: 'SUPABASE' | 'R2'; storage_bucket: string; storage_path: string; original_file_name: string; mime_type: string }[]>('client_document_download', { p_document: id });
    return rows[0];
  }

  // ---- calendar and documents (the support team)
  activityCustomers(search: string | null) { return this.rpc<{ id: string; code: string | null; name: string; company: string | null; hasClientLogin: boolean }[]>('client_activity_customers', { p_search: search }); }
  activityList(customerId: string) { return this.rpc<ClientActivityList>('client_activity_list', { p_customer: customerId }); }
  logActivity(customerId: string, i: ClientActivityInput) {
    return this.rpc<ClientCalendarEvent>('log_client_activity', { p_customer: customerId, p_service: i.serviceCode, p_date: i.date, p_kind: i.kind, p_title: i.title, p_summary: i.summary, p_metrics: i.metrics });
  }
  updateActivity(id: string, i: ClientActivityInput) {
    return this.rpc<ClientCalendarEvent>('update_client_activity', { p_id: id, p_service: i.serviceCode, p_date: i.date, p_kind: i.kind, p_title: i.title, p_summary: i.summary, p_metrics: i.metrics });
  }
  async deleteActivity(id: string): Promise<void> { await this.rpc('delete_client_activity', { p_id: id }); }
  documentQueue(status: 'PENDING' | 'REVIEWED') { return this.rpc<ClientDocumentQueueItem[]>('client_document_queue', { p_status: status }); }
  async reviewDocument(customerId: string, item: string, decision: string, note: string | null): Promise<void> {
    await this.rpc('review_client_document', { p_customer: customerId, p_item: item, p_decision: decision, p_note: note });
  }
  async uploadFile(id: string) {
    const rows = await this.rpc<{ storage_provider: 'SUPABASE' | 'R2'; storage_bucket: string; storage_path: string; original_file_name: string; mime_type: string }[]>('client_upload_download', { p_document: id });
    return rows[0];
  }

  // ---- the internal sides (Technical Consultant, Accounts)
  openServiceRequests() { return this.rpc<ConsultantOpenServiceRequest[]>('consultant_open_service_requests'); }
  consultantServiceRequests(customerId: string) { return this.rpc<ConsultantServiceRequest[]>('consultant_service_requests', { p_customer: customerId }); }
  async decideServiceRequest(id: string, decision: string, note: string | null): Promise<void> {
    await this.rpc('consultant_decide_service_request', { p_request: id, p_decision: decision, p_note: note });
  }
  accountsPlans() { return this.rpc<AccountsPlans>('accounts_plans'); }
  savePlan(i: { id: string | null; code: string | null; name: string; description: string | null; price: number; features: string[]; services: string[]; active: boolean }) {
    return this.rpc<string>('accounts_save_plan', {
      p_id: i.id, p_code: i.code, p_name: i.name, p_description: i.description, p_price: i.price,
      p_features: i.features, p_services: i.services, p_active: i.active
    });
  }
  async decidePlanRequest(id: string, i: { decision: string; note: string | null; paymentConfirmed: boolean; renewsOn: string | null }): Promise<void> {
    await this.rpc('accounts_decide_plan_request', { p_request: id, p_decision: i.decision, p_note: i.note, p_payment_confirmed: i.paymentConfirmed, p_renews_on: i.renewsOn });
  }
  async replyToClientTicket(ticket: string, message: string): Promise<void> {
    await this.rpc('reply_to_client_ticket', { p_ticket: ticket, p_message: message });
  }
}
