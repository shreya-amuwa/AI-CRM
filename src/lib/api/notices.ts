import type { CompanyNotice, NoticeAcknowledged, NoticeAudienceOptions, NoticeDeleted, NoticeList, NoticeManagers, NoticePending, NoticeReceipts } from '../../../shared/contracts';
import { api } from './client';

/** Company Notice Board (migration 20270131000200). Files use the issue upload / download routes (employeeCasesApi). */
export type NoticeQuery = { scope?: 'INBOX' | 'ALL' | 'MINE'; category?: string; priority?: string; from?: string; to?: string; unread?: boolean; search?: string; limit?: number; offset?: number };
const clean = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== false)) as Record<string, string | number | boolean>;
export const noticesApi = {
  list: (q: NoticeQuery = {}) => api.get<NoticeList>('/notices', clean(q)),
  unreadCount: async () => (await api.get<{ unread: number }>('/notices/unread-count')).unread,
  audience: () => api.get<NoticeAudienceOptions>('/notices/audience'),
  open: (id: string) => api.get<CompanyNotice>(`/notices/${encodeURIComponent(id)}`),
  receipts: (id: string) => api.get<NoticeReceipts>(`/notices/${encodeURIComponent(id)}/receipts`),
  publish: (b: Record<string, unknown>) => api.post<CompanyNotice>('/notices', b),
  update: (id: string, b: Record<string, unknown>) => api.post<CompanyNotice>(`/notices/${encodeURIComponent(id)}/update`, b),
  /** The popup queue: what this employee has not acknowledged yet. */
  pending: () => api.get<NoticePending>('/notices/pending'),
  acknowledge: (id: string) => api.post<NoticeAcknowledged>(`/notices/${encodeURIComponent(id)}/acknowledge`, {}),
  managers: () => api.get<NoticeManagers>('/notices/managers'),
  setManager: (profileId: string, enabled: boolean) => api.post<{ profileId: string; manager: boolean }>(`/notices/managers/${encodeURIComponent(profileId)}`, { enabled }),
  archive: (id: string) => api.post<CompanyNotice>(`/notices/${encodeURIComponent(id)}/archive`, {}),
  /** Delete (soft): only the notice's publisher or the Super Admin; the database checks. */
  remove: (id: string) => api.delete<NoticeDeleted>(`/notices/${encodeURIComponent(id)}`)
};
