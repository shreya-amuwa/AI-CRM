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
  submit(i: { title: string; description: string; steps?: string | null; attachmentIds: string[]; clientRequestId: string }) {
    return this.rpc<DevBug>('bug_submit', { p_title: i.title, p_description: i.description, p_steps: i.steps ?? null, p_attachments: i.attachmentIds, p_client_request_id: i.clientRequestId });
  }
  mine() { return this.rpc<DevBugRow[]>('bug_my_list'); }
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
  setTeam(profileId: string, member: boolean) { return this.rpc<DevTeamMember[]>('dev_team_set', { p_profile: profileId, p_member: member }); }
}
