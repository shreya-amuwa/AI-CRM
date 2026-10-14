import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccountsPlans,
  ClientCatalogService,
  ClientInvoice,
  ClientNotifications,
  ClientOverview,
  ClientPlans,
  ClientProfile,
  ClientService,
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
  services() { return this.rpc<ClientService[]>('client_services'); }
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
  async invoiceFile(id: string) {
    const rows = await this.rpc<{ storage_bucket: string; storage_path: string; original_file_name: string; mime_type: string }[]>('client_invoice_file', { p_invoice: id });
    return rows[0];
  }

  tickets() { return this.rpc<ClientTicket[]>('client_tickets'); }
  ticket(id: string) { return this.rpc<ClientTicketDetail>('client_ticket', { p_ticket: id }); }
  createTicket(i: { subject: string; description: string; category: string; serviceCode: string | null }) {
    return this.rpc<ClientTicket>('client_create_ticket', { p_subject: i.subject, p_description: i.description, p_category: i.category, p_service: i.serviceCode });
  }
  replyTicket(id: string, message: string) { return this.rpc<ClientTicketDetail>('client_reply_ticket', { p_ticket: id, p_message: message }); }

  notifications(limit: number, offset: number) { return this.rpc<ClientNotifications>('client_notifications', { p_limit: limit, p_offset: offset }); }
  markRead(ids: string[] | null) { return this.rpc<number>('client_mark_notifications_read', { p_ids: ids }); }

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
