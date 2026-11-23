import type { SupabaseClient } from '@supabase/supabase-js';
import type { DevBug, DevBugAccess, DevBugList, DevBugRow, DevTeamMember } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** Bugs for the Developers team (20270122000300): every call is a database function that checks the caller (reporter or developer). */
export class BugRepository {
  constructor(private readonly db: SupabaseClient) {}
  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }
  access() { return this.rpc<DevBugAccess>('bug_access'); }
  // an issue to the Developer Team with its category, priority and the affected department / employee (20270127000200)
  submit(i: { title: string; description: string; steps?: string | null; attachmentIds: string[]; clientRequestId: string; category: string; priority: string;
    affectedDepartmentId?: string | null; affectedEmployeeId?: string | null }) {
    return this.rpc<DevBug>('bug_report', { p: {
      title: i.title, description: i.description, steps: i.steps ?? null, attachmentIds: i.attachmentIds, clientRequestId: i.clientRequestId, category: i.category,
      priority: i.priority, affectedDepartmentId: i.affectedDepartmentId ?? null, affectedEmployeeId: i.affectedEmployeeId ?? null } });
  }
  mine(q: { status?: string; search?: string } = {}) { return this.rpc<DevBugRow[]>('bug_my_list', { p_status: q.status ?? null, p_search: q.search || null }); }
  followUp(id: string, message: string, attachmentIds: string[]) { return this.rpc<DevBug>('bug_my_follow_up', { p_id: id, p_message: message, p_attachments: attachmentIds }); }
  reply(id: string, message: string, requestInfo: boolean) { return this.rpc<DevBug>('bug_dev_reply', { p_id: id, p_message: message, p_request_info: requestInfo }); }
  myDetail(id: string) { return this.rpc<DevBug>('bug_my_detail', { p_id: id }); }
  list(i: { status?: string; assignee?: string; search?: string; page: number; pageSize: number }) {
    return this.rpc<DevBugList>('bug_dev_list', {
      p_status: i.status ?? null, p_assignee: i.assignee ?? null, p_search: i.search || null, p_limit: i.pageSize, p_offset: (i.page - 1) * i.pageSize
    });
  }
  detail(id: string) { return this.rpc<DevBug>('bug_dev_detail', { p_id: id }); }
  assign(id: string, developerId: string | null) { return this.rpc<DevBug>('bug_dev_assign', { p_id: id, p_developer: developerId }); }
  setStatus(id: string, status: string, note?: string | null) { return this.rpc<DevBug>('bug_dev_set_status', { p_id: id, p_status: status, p_note: note ?? null }); }
  comment(id: string, note: string) { return this.rpc<DevBug>('bug_dev_comment', { p_id: id, p_note: note }); }
  team() { return this.rpc<DevTeamMember[]>('dev_team_list'); }
  setTeam(profileId: string, member: boolean, lead?: boolean) { return this.rpc<DevTeamMember[]>('dev_team_set', { p_profile: profileId, p_member: member, p_lead: lead ?? null }); }
}
