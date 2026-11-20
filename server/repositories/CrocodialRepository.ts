import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrocodialAdminOverview, CrocodialConnection, CrocodialMapping, CrocodialMappingCheck, CrocodialMyStatus, CrocodialSyncStatus, CrocodialActivity, CrocodialLeads, CrocodialTeamActivity } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** The Crocodial integration's database functions, called with the signed-in user's own login (the database decides who may do what). */
export class CrocodialRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  overview() { return this.rpc<CrocodialAdminOverview>('croc_admin_overview'); }
  rolloutSet(departmentId: string, division: string, allowed: boolean, note: string | null) {
    return this.rpc<CrocodialAdminOverview>('croc_rollout_set', { p_department: departmentId, p_division: division, p_allowed: allowed, p_note: note });
  }
  connectionSave(p: Record<string, unknown>) { return this.rpc<CrocodialConnection>('croc_connection_save', { p }); }
  connection(id: string) { return this.rpc<CrocodialConnection>('croc_admin_connection', { p_id: id }); }
  departmentLinkSave(connectionId: string, departmentId: string, division: string, enabled: boolean, stage: string) {
    return this.rpc<{ id: string }>('croc_department_link_save', {
      p_connection: connectionId, p_department: departmentId, p_division: division, p_enabled: enabled, p_stage: stage
    });
  }
  mappingCheck(connectionId: string, externalEmployeeId: number, profileId: string, departmentId: string) {
    return this.rpc<CrocodialMappingCheck>('croc_mapping_check', {
      p_connection: connectionId, p_external_employee: externalEmployeeId, p_profile: profileId, p_department: departmentId
    });
  }
  mappingCreate(connectionId: string, externalEmployeeId: number, profileId: string, departmentId: string) {
    return this.rpc<CrocodialMapping>('croc_mapping_create', {
      p_connection: connectionId, p_external_employee: externalEmployeeId, p_profile: profileId, p_department: departmentId
    });
  }
  mappingApprove(id: string) { return this.rpc<CrocodialMapping>('croc_mapping_approve', { p_id: id }); }
  mappingCountFrom(id: string, from: string | null) { return this.rpc<CrocodialMapping>('croc_mapping_count_from', { p_id: id, p_from: from }); }
  mappingRevoke(id: string, reason: string | null) { return this.rpc<CrocodialMapping>('croc_mapping_revoke', { p_id: id, p_reason: reason }); }
  myStatus() { return this.rpc<CrocodialMyStatus>('croc_my_status'); }
  activity(profileId: string | null, from: string | null, to: string | null) {
    return this.rpc<CrocodialActivity>('croc_activity', { p_profile: profileId, p_from: from, p_to: to });
  }
  leads(profileId: string | null, search: string | null, filter: string, page: number, pageSize: number) {
    return this.rpc<CrocodialLeads>('croc_leads', { p_profile: profileId, p_search: search, p_filter: filter, p_page: page, p_page_size: pageSize });
  }
  teamActivity(from: string | null, to: string | null, departmentId: string | null, teamId: string | null) {
    return this.rpc<CrocodialTeamActivity>('croc_team_activity', { p_from: from, p_to: to, p_department: departmentId, p_team: teamId });
  }
  syncStatus() { return this.rpc<CrocodialSyncStatus[]>('croc_sync_status'); }
  /** Checks the caller (Super Admin), the connection is on, and the 5-minute limit; records the request. */
  syncRequest(id: string) { return this.rpc<{ id: string; credentialRef: string }>('croc_sync_request', { p_connection: id }); }
}
