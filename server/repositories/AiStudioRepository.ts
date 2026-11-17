import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AiStudioOverview, AiStudioPerson, AiStudioProject, AiStudioReportContext, AiStudioReportDetail, AiStudioReportPage, AiStudioTask, AiStudioTaskDetail, AiStudioTaskPage
} from '../../shared/contracts.js';
import { AppError } from '../http/errors.js';
import { unwrap } from './base.js';

/** AI Studio: projects, tasks and daily reports. Every rule (who sees what, who decides) is in the database functions; the caller's JWT is what they read. */
export class AiStudioRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  overview() { return this.rpc<AiStudioOverview>('ai_studio_overview'); }
  people() { return this.rpc<AiStudioPerson[]>('ai_studio_people'); }

  projects() { return this.rpc<AiStudioProject[]>('ai_studio_projects_list'); }
  saveProject(id: string | null, i: { name: string; description?: string | null; status?: string }) {
    return this.rpc<Pick<AiStudioProject, 'id' | 'name' | 'description' | 'status' | 'createdAt'>>('ai_studio_project_save', {
      p_id: id, p_name: i.name, p_description: i.description ?? null, p_status: i.status ?? null
    });
  }
  assignProject(projectId: string, profileId: string, assign: boolean) {
    return this.rpc<{ projectId: string; profileId: string; assigned: boolean }>('ai_studio_project_assign', { p_project: projectId, p_profile: profileId, p_assign: assign });
  }
  /**
   * Before an account is made: the projects (and Team Lead) chosen for a new AI Studio employee are valid. A no-op for any other department.
   * On a database without the AI Studio migration the check is skipped (employees of every other department are still created), unless the
   * request asked for AI Studio projects.
   */
  async checkPlacement(i: { departmentId?: string; role: string; teamId?: string; projectIds?: string[]; leadId?: string }): Promise<void> {
    const { error } = await this.db.rpc('ai_studio_project_check', {
      p_department: i.departmentId ?? null, p_role: i.role, p_team: i.teamId ?? null, p_projects: i.projectIds ?? [], p_lead: i.leadId ?? null
    });
    if (!error) return;
    if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) {
      if (i.projectIds?.length || i.leadId) throw new AppError('SERVICE_UNAVAILABLE', 'AI Studio is not set up in the database yet. Ask the administrator to run the AI Studio migration.');
      return;
    }
    unwrap({ data: null, error });
  }
  /** Assigns Team Members (one or many) to an active AI Studio Team Lead: all or nothing. */
  assignLead(memberIds: string[], leadId: string) { return this.rpc<{ leadId: string; assigned: number; alreadyAssigned: number }>('ai_studio_assign_lead', { p_members: memberIds, p_lead: leadId }); }
  /** Changes the Team Lead of a Team Member (Department Head / Super Admin); the new lead must be on the member's projects. */
  setLead(memberId: string, leadId: string) { return this.rpc<{ memberId: string; leadId: string }>('ai_studio_set_lead', { p_member: memberId, p_lead: leadId }); }
  /** Names the Team Lead of a Team Member (Department Head / Super Admin): the existing function every department uses. */
  async assignDirectLead(memberId: string, leadId: string) {
    await this.rpc<unknown>('assign_direct_lead', { p_member: memberId, p_lead: leadId });
  }

  tasks(q: { scope: string; projectId?: string; status?: string; assigneeId?: string; page: number; pageSize: number }) {
    return this.rpc<AiStudioTaskPage>('ai_studio_tasks_list', {
      p_scope: q.scope, p_project: q.projectId ?? null, p_status: q.status ?? null, p_assignee: q.assigneeId ?? null, p_page: q.page, p_page_size: q.pageSize
    });
  }
  task(id: string) { return this.rpc<AiStudioTaskDetail>('ai_studio_task_get', { p_task: id }); }
  assignTask(i: { projectId: string; assigneeId: string; title: string; description?: string | null; priority: string; dueDate?: string | null; attachments?: string[] }) {
    return this.rpc<AiStudioTask>('ai_studio_task_assign', {
      p_project: i.projectId, p_assignee: i.assigneeId, p_title: i.title, p_description: i.description ?? null, p_priority: i.priority, p_due: i.dueDate ?? null,
      p_links: i.attachments ?? null
    });
  }
  editTask(id: string, i: { title: string; description?: string | null; priority: string; dueDate?: string | null }) {
    return this.rpc<AiStudioTask>('ai_studio_task_edit', { p_task: id, p_title: i.title, p_description: i.description ?? null, p_priority: i.priority, p_due: i.dueDate ?? null });
  }
  updateTask(id: string, i: { status: string; progress: number; note?: string | null; attachments?: string[] }) {
    return this.rpc<AiStudioTask>('ai_studio_task_update', { p_task: id, p_status: i.status, p_progress: i.progress, p_note: i.note ?? null, p_links: i.attachments ?? null });
  }

  reportContext() { return this.rpc<AiStudioReportContext>('ai_studio_report_context'); }
  reports(q: { view: string; projectId?: string; status?: string; leadId?: string; authorId?: string; from?: string; to?: string; page: number; pageSize: number }) {
    return this.rpc<AiStudioReportPage>('ai_studio_reports_list', {
      p_view: q.view, p_project: q.projectId ?? null, p_status: q.status ?? null, p_lead: q.leadId ?? null, p_author: q.authorId ?? null,
      p_from: q.from ?? null, p_to: q.to ?? null, p_page: q.page, p_page_size: q.pageSize
    });
  }
  report(id: string) { return this.rpc<AiStudioReportDetail>('ai_studio_report_get', { p_id: id }); }
  saveReport(id: string | null, i: { projectId: string; taskId?: string | null; reportDate: string; workCompleted?: string | null; workInProgress?: string | null; pendingWork?: string | null; blockers?: string | null; remarks?: string | null; submit: boolean }) {
    return this.rpc<AiStudioReportDetail>('ai_studio_report_save', {
      p_id: id, p_project: i.projectId, p_task: i.taskId ?? null, p_date: i.reportDate, p_work_completed: i.workCompleted ?? null,
      p_work_in_progress: i.workInProgress ?? null, p_pending_work: i.pendingWork ?? null, p_blockers: i.blockers ?? null, p_remarks: i.remarks ?? null, p_submit: i.submit
    });
  }
  async deleteDraft(id: string) { await this.rpc<null>('ai_studio_report_delete_draft', { p_id: id }); }
  reviewReport(id: string, decision: string, comment?: string | null) {
    return this.rpc<AiStudioReportDetail>('ai_studio_report_review', { p_report: id, p_decision: decision, p_comment: comment ?? null });
  }
}
