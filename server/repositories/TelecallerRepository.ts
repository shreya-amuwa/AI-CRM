import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  TelecallerAssignee, TelecallerContact, TelecallerContactList, TelecallerHome, TelecallerLead, TelecallerLeadList, TelecallerSheet, TelecallerSheetCheck
} from '../../shared/contracts.js';
import { getServiceClient } from '../db/supabase.js';
import { unwrap } from './base.js';

/** Telecaller: contact sheets, call updates, leads and the Home counts. Who may do what is decided in the database. */
export class TelecallerRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  home() { return this.rpc<TelecallerHome>('telecaller_home'); }
  assignable(departmentId?: string) { return this.rpc<TelecallerAssignee[]>('telecaller_assignable', { p_department: departmentId ?? null }); }
  lists(assigneeId?: string) { return this.rpc<TelecallerSheet[]>('telecaller_lists', { p_assignee: assigneeId ?? null }); }

  assignSheet(i: { assigneeId: string; fileName: string; note?: string | null; rows: unknown[]; hash: string; commit: boolean }) {
    return this.rpc<TelecallerSheetCheck>('telecaller_list_assign', {
      p_assignee: i.assigneeId, p_file_name: i.fileName, p_note: i.note ?? null, p_rows: i.rows, p_hash: i.hash, p_commit: i.commit
    });
  }
  sourceBegin(listId: string) { return this.rpc<{ id: string; fileName: string; departmentId: string; contentHash: string }>('telecaller_list_source_begin', { p_list: listId }); }
  /** After the database allowed it and the file is stored: keep the reference next to the sheet (service role only). */
  async recordSource(listId: string, file: { bucket: string; path: string; provider: string; reference: string; etag: string | null; size: number }) {
    unwrap(await getServiceClient().rpc('telecaller_list_record_source', {
      p_list: listId, p_bucket: file.bucket, p_path: file.path, p_provider: file.provider, p_ref: file.reference, p_etag: file.etag, p_size: file.size
    }));
  }

  contacts(i: { listId?: string; search?: string; status?: string; page: number; pageSize: number }) {
    return this.rpc<TelecallerContactList>('telecaller_contacts_list', {
      p_list: i.listId ?? null, p_search: i.search || null, p_status: i.status ?? null, p_page: i.page, p_page_size: i.pageSize
    });
  }
  updateContact(id: string, i: { callStatus: string; remarks?: string | null; followUpDate?: string | null; called?: boolean }) {
    return this.rpc<Pick<TelecallerContact, 'id' | 'callStatus' | 'lastCalledAt' | 'followUpDate' | 'remarks' | 'callCount'>>('telecaller_contact_update', {
      p_id: id, p_status: i.callStatus, p_remarks: i.remarks ?? null, p_follow_up: i.followUpDate ?? null, p_called: i.called ?? true
    });
  }

  leads(i: { search?: string; temperature?: string; callStatus?: string; source?: string; page: number; pageSize: number }) {
    return this.rpc<TelecallerLeadList>('telecaller_leads_list', {
      p_search: i.search || null, p_temperature: i.temperature ?? null, p_call_status: i.callStatus ?? null, p_source: i.source || null, p_page: i.page, p_page_size: i.pageSize
    });
  }
  lead(id: string) { return this.rpc<TelecallerLead>('telecaller_lead_get', { p_id: id }); }
  saveLead(id: string | null, fields: Record<string, unknown>, services: string[] | null, temperature: string, callStatus: string) {
    return this.rpc<TelecallerLead>('telecaller_lead_save', { p_id: id, p_fields: fields, p_services: services, p_temperature: temperature, p_call_status: callStatus });
  }
}
