import type { LeadStatus, LeadTag, LeadTagColour } from '../../../shared/contracts';
import { api } from './client';

/** Lead tags (migration 20270305000100). The database decides who may manage which tag and which tags a lead may take. */
export type LeadTagInput = { id?: string; label: string; colour: LeadTagColour; stage: LeadStatus; departmentIds?: string[] };
export const leadTagsApi = {
  /** The tags the signed-in person may see; with a department, those visible there (the lead form). */
  list: (departmentId?: string) => api.get<LeadTag[]>('/lead-tags', departmentId ? { departmentId } : undefined),
  /** Create (no id) or change a tag. A stage change moves every lead with the tag. */
  save: (input: LeadTagInput) => api.post<LeadTag>('/lead-tags', input),
  retire: (id: string, retired: boolean) => api.post<LeadTag>(`/lead-tags/${encodeURIComponent(id)}/retire`, { retired }),
  setOnLead: (leadId: string, tagId: string) => api.post<{ id: string; tagId: string }>(`/pipeline/leads/${encodeURIComponent(leadId)}/tag`, { tagId })
};
