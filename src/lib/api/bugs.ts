import type { DevBug, DevBugAccess, DevBugList, DevBugRow, DevBugStatus, DevTeamMember } from '../../../shared/contracts';
import { api } from './client';

/** Bugs for the Developers team (migration 20270122000300). Files use the issue upload / download routes (employeeCasesApi). */
export const bugsApi = {
  access: () => api.get<DevBugAccess>('/bugs/access'),
  submit: (b: { title: string; description: string; steps?: string | null; attachmentIds: string[]; clientRequestId: string }) => api.post<DevBug>('/bugs', b),
  mine: () => api.get<DevBugRow[]>('/bugs/mine'),
  myDetail: (id: string) => api.get<DevBug>(`/bugs/mine/${encodeURIComponent(id)}`),
  list: (q: { status?: string; assignee?: string; search?: string; page?: number; pageSize?: number }) => api.get<DevBugList>('/bugs', q),
  detail: (id: string) => api.get<DevBug>(`/bugs/${encodeURIComponent(id)}`),
  assign: (id: string, developerId: string | null) => api.post<DevBug>(`/bugs/${encodeURIComponent(id)}/assign`, { developerId }),
  setStatus: (id: string, status: DevBugStatus, note?: string | null) => api.post<DevBug>(`/bugs/${encodeURIComponent(id)}/status`, { status, note: note || null }),
  comment: (id: string, note: string) => api.post<DevBug>(`/bugs/${encodeURIComponent(id)}/comment`, { note }),
  team: () => api.get<DevTeamMember[]>('/bugs/team'),
  setTeam: (profileId: string, member: boolean) => api.post<DevTeamMember[]>('/bugs/team', { profileId, member })
};
