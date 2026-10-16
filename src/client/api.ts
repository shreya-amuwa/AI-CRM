import type {
  ClientAnnouncement, ClientCatalogService, ClientDocumentUrl, ClientInvoice, ClientNotifications, ClientOverview, ClientPlans, ClientProfile,
  ClientService, ClientServiceRequest, ClientTicket, ClientTicketDetail
} from '../../shared/contracts';
import { api } from '../lib/api/client';

/** Everything the client dashboard can ask the server. No customer id is ever sent: the server works it out from the login. */
export const clientApi = {
  me: () => api.get<ClientProfile>('/client/me'),
  overview: () => api.get<ClientOverview>('/client/overview'),
  services: () => api.get<ClientService[]>('/client/services'),
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
  createTicket: (input: { subject: string; description: string; category: string; serviceCode?: string | null }) =>
    api.post<ClientTicket>('/client/tickets', { ...input, serviceCode: input.serviceCode || undefined }),
  replyTicket: (id: string, message: string) => api.post<unknown>(`/client/tickets/${id}/replies`, { message }),
  ticketSeen: (id: string) => api.post<{ marked: number }>(`/client/tickets/${id}/seen`, {}),
  announcements: () => api.get<ClientAnnouncement[]>('/client/announcements'),
  dismissAnnouncement: (id: string, occurrence: string) => api.post<null>(`/client/announcements/${id}/dismiss`, { occurrence }),
  notifications: (limit = 20, offset = 0) => api.get<ClientNotifications>('/client/notifications', { limit, offset }),
  markRead: (ids?: string[]) => api.post<unknown>('/client/notifications/read', ids ? { ids } : {})
};
