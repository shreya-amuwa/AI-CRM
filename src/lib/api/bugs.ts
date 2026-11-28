import type { DevBug, DevBugAccess, DevBugList, DevBugRow, DevBugStatus, DevTeamMember } from '../../../shared/contracts';
import { api } from './client';

/** Bugs for the Developers team (migration 20270122000300). Files use the issue upload / download routes (employeeCasesApi). */
export const bugsApi = {
  access: () => api.get<DevBugAccess>('/bugs/access'),
  // an issue to the Developer Team (20270128000200: with its category, priority and, for HR, the affected department / employee)
  submit: (b: { title: string; description: string; steps?: string | null; attachmentIds: string[]; clientRequestId: string; category?: string; priority?: string;
    affectedDepartmentId?: string | null; affectedEmployeeId?: string | null }) => api.post<DevBug>('/bugs', b),
  mine: (q: { status?: string; search?: string } = {}) => api.get<DevBugRow[]>('/bugs/mine', Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>),
  followUp: (id: string, message: string, attachmentIds: string[] = []) => api.post<DevBug>(`/bugs/mine/${encodeURIComponent(id)}/follow-up`, { message, attachmentIds }),
  reply: (id: string, message: string, requestInfo = false) => api.post<DevBug>(`/bugs/${encodeURIComponent(id)}/reply`, { message, requestInfo }),
  myDetail: (id: string) => api.get<DevBug>(`/bugs/mine/${encodeURIComponent(id)}`),
  list: (q: { status?: string; assignee?: string; search?: string; page?: number; pageSize?: number }) => api.get<DevBugList>('/bugs', q),
  detail: (id: string) => api.get<DevBug>(`/bugs/${encodeURIComponent(id)}`),
  assign: (id: string, developerId: string | null) => api.post<DevBug>(`/bugs/${encodeURIComponent(id)}/assign`, { developerId }),
  setStatus: (id: string, status: DevBugStatus, note?: string | null) => api.post<DevBug>(`/bugs/${encodeURIComponent(id)}/status`, { status, note: note || null }),
  addUpdate: (id: string, b: { work: string; status?: DevBugStatus; progress?: number; notes?: string | null; expectedVersion?: number; clientRequestId?: string }) =>
    api.post<DevBug>(`/bugs/${encodeURIComponent(id)}/updates`, b),
  comment: (id: string, note: string) => api.post<DevBug>(`/bugs/${encodeURIComponent(id)}/comment`, { note }),
  team: () => api.get<DevTeamMember[]>('/bugs/team'),
  setTeam: (profileId: string, member: boolean, lead?: boolean) => api.post<DevTeamMember[]>('/bugs/team', { profileId, member, ...(lead === undefined ? {} : { lead }) })
};
