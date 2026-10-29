import type {
  ClientAnnouncement, ClientJourney, ClientCalendarEvent, ClientCampaign, ClientCatalogService, ClientDocumentUrl, ClientDocuments, CustomerDocument, DocumentUploadTicket, ClientInvoice, ClientNotifications, ClientOverview, ClientPlans, ClientProfile,
  ClientBilling, ClientService, ClientServiceProgress, ClientServiceRequest, ClientTicket, ClientTicketDetail, TicketAttachment, TicketUploadTicket
} from '../../shared/contracts';
import { api } from '../lib/api/client';

/** Everything the client dashboard can ask the server. No customer id is ever sent: the server works it out from the login. */
export const clientApi = {
  me: () => api.get<ClientProfile>('/client/me'),
  /** Choose your own password (the server sets it, so a temporary password cannot be kept). */
  changePassword: (password: string) => api.post<{ changed: true }>('/client/password', { password }),
  overview: () => api.get<ClientOverview>('/client/overview'),
  journey: () => api.get<ClientJourney>('/client/journey'),
  services: () => api.get<ClientService[]>('/client/services'),
  billing: () => api.get<ClientBilling>('/client/billing'),
  serviceProgress: () => api.get<ClientServiceProgress[]>('/client/service-progress'),
  campaigns: () => api.get<ClientCampaign[]>('/client/campaigns'),
  /** No login needed; the answer is the same whatever the e-mail. */
  forgotPassword: (email: string) => api.post<{ ok: true }>('/client-auth/forgot-password', { email }),
  catalog: () => api.get<ClientCatalogService[]>('/client/catalog'),
  serviceRequests: () => api.get<ClientServiceRequest[]>('/client/service-requests'),
  requestService: (serviceCode: string, note?: string) => api.post<ClientServiceRequest>('/client/service-requests', { serviceCode, note: note || undefined }),
  cancelServiceRequest: (id: string) => api.delete<null>(`/client/service-requests/${id}`),
  plans: () => api.get<ClientPlans>('/client/plans'),
  requestPlan: (planId: string, note?: string) => api.post<unknown>('/client/plan-requests', { planId, note: note || undefined }),
  invoices: () => api.get<ClientInvoice[]>('/client/invoices'),
  invoiceUrl: (id: string, action: 'view' | 'download') => api.get<ClientDocumentUrl>(`/client/invoices/${id}/url`, { action }),
  tickets: () => api.get<ClientTicket[]>('/client/tickets'),
  ticket: (id: string) => api.get<ClientTicketDetail>(`/client/tickets/${id}`),
  createTicket: (input: { subject: string; description: string; category: string; serviceCode?: string | null; attachmentIds?: string[] }) =>
    api.post<ClientTicket>('/client/tickets', { ...input, serviceCode: input.serviceCode || undefined }),
  replyTicket: (id: string, message: string) => api.post<unknown>(`/client/tickets/${id}/replies`, { message }),
  sendTicketMessage: (id: string, message: string, clientMsgId: string, attachmentIds: string[] = []) =>
    api.post<ClientTicketDetail>(`/client/tickets/${id}/messages`, { message, clientMsgId, attachmentIds }),
  ticketAttachments: (id: string) => api.get<TicketAttachment[]>(`/client/tickets/${id}/attachments`),
  beginTicketUpload: (body: { ticketId?: string; fileName: string; mimeType: string; sizeBytes: number }) => api.post<TicketUploadTicket>('/client/tickets/uploads', body),
  completeTicketUpload: (id: string) => api.post<TicketAttachment>(`/client/tickets/uploads/${id}/complete`, {}),
  abortTicketUpload: (id: string) => api.post<null>(`/client/tickets/uploads/${id}/abort`, {}),
  ticketAttachmentUrl: (id: string, action: 'view' | 'download' = 'view') => api.get<ClientDocumentUrl>(`/client/tickets/attachments/${id}/url`, { action }),
  ticketSeen: (id: string) => api.post<{ marked: number }>(`/client/tickets/${id}/seen`, {}),
  calendar: (from: string, to: string) => api.get<ClientCalendarEvent[]>('/client/calendar', { from, to }),
  documents: () => api.get<ClientDocuments>('/client/documents'),
  beginDocumentUpload: (input: { itemCode: string; fileName: string; mimeType: string; sizeBytes: number }) => api.post<DocumentUploadTicket>('/client/documents/uploads', input),
  completeDocumentUpload: (id: string) => api.post<CustomerDocument>(`/client/documents/uploads/${id}/complete`, {}),
  abortDocumentUpload: (id: string) => api.post<null>(`/client/documents/uploads/${id}/abort`, {}),
  saveDetail: (itemCode: string, value: string) => api.post<null>('/client/documents/details', { itemCode, value }),
  documentUrl: (id: string, action: 'view' | 'download') => api.get<ClientDocumentUrl>(`/client/documents/${id}/url`, { action }),
  announcements: () => api.get<ClientAnnouncement[]>('/client/announcements'),
  dismissAnnouncement: (id: string, occurrence: string) => api.post<null>(`/client/announcements/${id}/dismiss`, { occurrence }),
  notifications: (limit = 20, offset = 0) => api.get<ClientNotifications>('/client/notifications', { limit, offset }),
  markRead: (ids?: string[]) => api.post<unknown>('/client/notifications/read', ids ? { ids } : {})
};
