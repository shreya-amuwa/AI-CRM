import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  SalesIncome, SalesLeadAssignee, SalesTeamPerson, SalesLeadDetail, SalesLeadList, SalesOverview, SalesReport, SalesSheet, SalesSheetCheck, SalesTaskAssignee, SalesTaskList
} from '../../shared/contracts.js';
import { getServiceClient } from '../db/supabase.js';
import { unwrap } from './base.js';

/** Sales Department Head: every call is a database function that checks the caller is a Sales Department Head and reads the Sales teams only. */
export class SalesHeadRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  overview() { return this.rpc<SalesOverview>('sales_head_overview'); }

  assignees() { return this.rpc<SalesLeadAssignee[]>('sales_lead_assignees'); }
  teamPeople() { return this.rpc<SalesTeamPerson[]>('sales_team_people'); }
  sheets() { return this.rpc<SalesSheet[]>('sales_lead_sheets_list'); }
  assignSheet(i: { assigneeId: string; fileName: string; note?: string | null; rows: unknown[]; hash: string; commit: boolean }) {
    return this.rpc<SalesSheetCheck>('sales_lead_sheet_assign', {
      p_assignee: i.assigneeId, p_file_name: i.fileName, p_note: i.note ?? null, p_rows: i.rows, p_hash: i.hash, p_commit: i.commit
    });
  }
  sourceBegin(sheetId: string) { return this.rpc<{ id: string; fileName: string; departmentId: string; contentHash: string }>('sales_lead_sheet_source_begin', { p_sheet: sheetId }); }
  /** After the database allowed it and the file is stored: keep the reference next to the sheet (service role only). */
  async recordSource(sheetId: string, file: { bucket: string; path: string; provider: string; reference: string; etag: string | null; size: number }) {
    unwrap(await getServiceClient().rpc('sales_lead_sheet_record_source', {
      p_sheet: sheetId, p_bucket: file.bucket, p_path: file.path, p_provider: file.provider, p_ref: file.reference, p_etag: file.etag, p_size: file.size
    }));
  }

  leads(i: { search?: string; filter: string; assigneeId?: string; sort: string; dir: string; page: number; pageSize: number }) {
    return this.rpc<SalesLeadList>('sales_leads_list', {
      p_search: i.search || null, p_filter: i.filter, p_assignee: i.assigneeId ?? null, p_sort: i.sort, p_dir: i.dir, p_page: i.page, p_page_size: i.pageSize
    });
  }
  lead(id: string) { return this.rpc<SalesLeadDetail>('sales_lead_get', { p_id: id }); }
  assignInbound(leadId: string, assigneeId: string) { return this.rpc<{ customerId: string; assignee: string }>('sales_inbound_assign', { p_lead: leadId, p_assignee: assigneeId }); }

  tasks(i: { filter: string; search?: string; assigneeId?: string; page: number; pageSize: number }) {
    return this.rpc<SalesTaskList>('sales_tasks_list', { p_filter: i.filter, p_search: i.search || null, p_assignee: i.assigneeId ?? null, p_page: i.page, p_page_size: i.pageSize });
  }
  taskAssignees() { return this.rpc<SalesTaskAssignee[]>('sales_task_assignees'); }
  createTask(i: { assigneeId: string; title: string; description?: string | null; priority: string; dueDate?: string | null }) {
    return this.rpc<string>('sales_task_assign', { p_assignee: i.assigneeId, p_title: i.title, p_description: i.description ?? null, p_priority: i.priority, p_due: i.dueDate ?? null });
  }

  reports(i: { who: string; from?: string; to?: string; taskStatus?: string }) {
    return this.rpc<SalesReport>('sales_head_reports', { p_who: i.who, p_from: i.from ?? null, p_to: i.to ?? null, p_task_status: i.taskStatus ?? null });
  }
  income(i: { from?: string; to?: string }) { return this.rpc<SalesIncome>('sales_head_income', { p_from: i.from ?? null, p_to: i.to ?? null }); }
}
