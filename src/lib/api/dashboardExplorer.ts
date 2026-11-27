import type { ImprovementRequestResult, ImprovementRequestRow, PreviewRecent, PreviewSession } from '../../../shared/contracts';
import type { ImprovementRequestInput } from '../../../shared/dashboardExplorer';
import { api } from './client';

/** Dashboard Explorer (20270301000100): the Managing Director's preview audit and improvement requests. The previews never use this API. */
export const dashboardExplorerApi = {
  startSession: (b: { dashboardId: string; department: string; scenario: string }) => api.post<PreviewSession>('/dashboard-explorer/sessions', b),
  endSession: (sessionId: string) => api.post<{ sessionId: string; ended: boolean }>('/dashboard-explorer/sessions/end', { sessionId }),
  recent: () => api.get<PreviewRecent[]>('/dashboard-explorer/recent'),
  suggest: (b: ImprovementRequestInput) => api.post<ImprovementRequestResult>('/dashboard-explorer/improvements', b),
  requests: () => api.get<ImprovementRequestRow[]>('/dashboard-explorer/improvements')
};
