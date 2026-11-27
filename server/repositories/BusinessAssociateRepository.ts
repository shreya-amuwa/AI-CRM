import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BaAssignee, BaClientResearch, BaContactDetail, BaContactList, BaDemo, BaHome, BaQuotation, BaQuotationRow, BaScope, BaScopeRow, ServicePrice, TelecallerLead, TelecallerLeadList
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** The Business Associate's contacts, quotations, demos, scope documents and leads. Who may do what is decided inside the database functions. */
export class BusinessAssociateRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  home() { return this.rpc<BaHome>('ba_home'); }
  assignees() { return this.rpc<BaAssignee[]>('ba_assignees'); }
  convertLead(leadId: string, assigneeId: string | null, note: string | null) {
    return this.rpc<{ contactId: string; assignedTo: string; assigneeName: string }>('telecaller_lead_convert', { p_lead: leadId, p_assignee: assigneeId, p_note: note });
  }
  reassign(contactId: string, assigneeId: string) { return this.rpc<{ contactId: string; assignedTo: string }>('ba_contact_reassign', { p_contact: contactId, p_assignee: assigneeId }); }

  contacts(i: { search?: string; stage?: string; page: number; pageSize: number }) {
    return this.rpc<BaContactList>('ba_contacts_list', { p_search: i.search || null, p_stage: i.stage ?? null, p_page: i.page, p_page_size: i.pageSize });
  }
  contact(id: string) { return this.rpc<BaContactDetail>('ba_contact_get', { p_id: id }); }
  updateContact(id: string, fields: Record<string, unknown>) { return this.rpc<BaContactDetail>('ba_contact_update', { p_id: id, p_fields: fields }); }
  addNote(id: string, note: string) { return this.rpc<{ ok: true }>('ba_contact_note_add', { p_id: id, p_note: note }); }

  prices() { return this.rpc<ServicePrice[]>('service_prices_list'); }
  savePrice(code: string, i: { unitLabel: string; unitPrice: number; gstRate: number; maxDiscountPct: number; isActive: boolean }) {
    return this.rpc<{ serviceCode: string; unitPrice: number }>('service_price_save', { p_code: code, p_unit_label: i.unitLabel, p_unit_price: i.unitPrice, p_gst_rate: i.gstRate, p_max_discount: i.maxDiscountPct, p_active: i.isActive });
  }

  quotations(contactId?: string) { return this.rpc<BaQuotationRow[]>('ba_quotations_list', { p_contact: contactId ?? null }); }
  quotation(id: string) { return this.rpc<BaQuotation>('ba_quotation_get', { p_id: id }); }
  saveQuotation(id: string | null, contactId: string | null, data: Record<string, unknown>) { return this.rpc<BaQuotation>('ba_quotation_save', { p_id: id, p_contact: contactId, p_data: data }); }
  reviewQuotation(id: string) { return this.rpc<BaQuotation>('ba_quotation_review', { p_id: id }); }
  reviseQuotation(id: string) { return this.rpc<BaQuotation>('ba_quotation_revise', { p_id: id }); }
  finalizeQuotationBegin(id: string) { return this.rpc<BaQuotation & { departmentId: string; issuedOn: string }>('ba_quotation_finalize_begin', { p_id: id }); }
  finalizeQuotationRecord(id: string, f: FileRecord) { return this.rpc<BaQuotation>('ba_quotation_finalize_record', fileArgs(id, f)); }
  quotationFile(id: string) { return this.rpc<StoredFile>('ba_quotation_file', { p_id: id }); }

  demos(q: { from?: string; to?: string; status?: string; contactId?: string }) {
    return this.rpc<BaDemo[]>('ba_demos_list', { p_from: q.from ?? null, p_to: q.to ?? null, p_status: q.status ?? null, p_contact: q.contactId ?? null });
  }
  saveDemo(id: string | null, contactId: string | null, data: Record<string, unknown>) { return this.rpc<BaDemo>('ba_demo_save', { p_id: id, p_contact: contactId, p_data: data }); }
  demoStatus(id: string, status: string, feedback?: string | null, followUp?: string | null) {
    return this.rpc<BaDemo>('ba_demo_status', { p_id: id, p_status: status, p_feedback: feedback ?? null, p_follow_up: followUp ?? null });
  }

  // client research (web)
  researchBegin(contactId: string, force: boolean) { return this.rpc<ResearchBegin>('ba_research_begin', { p_contact: contactId, p_force: force }); }
  researchRecord(contactId: string, key: string, r: { provider: string; suggestions: unknown; sources: unknown; usage: unknown; tavilyExhausted: boolean }) {
    return this.rpc<BaClientResearch>('ba_research_record', {
      p_contact: contactId, p_key: key, p_provider: r.provider, p_suggestions: r.suggestions, p_sources: r.sources, p_usage: r.usage, p_tavily_exhausted: r.tavilyExhausted
    });
  }
  researchPauseTavily(contactId: string) { return this.rpc<null>('ba_research_pause_tavily', { p_contact: contactId }); }
  researchLatest(contactId: string) { return this.rpc<BaClientResearch | null>('ba_research_latest', { p_contact: contactId }); }

  scopeContext(contactId: string) { return this.rpc<ScopeContext>('ba_scope_context', { p_contact: contactId }); }
  scopes(contactId: string) { return this.rpc<BaScopeRow[]>('ba_scope_list', { p_contact: contactId }); }
  scope(id: string) { return this.rpc<BaScope>('ba_scope_get', { p_id: id }); }
  saveScope(id: string | null, contactId: string | null, data: Record<string, unknown>) { return this.rpc<BaScope>('ba_scope_save', { p_id: id, p_contact: contactId, p_data: data }); }
  reviewScope(id: string) { return this.rpc<BaScope>('ba_scope_review', { p_id: id }); }
  finalizeScopeBegin(id: string) { return this.rpc<BaScope & { departmentId: string; issuedOn: string; serviceNames: Record<string, string>; client: { name: string; company: string | null } }>('ba_scope_finalize_begin', { p_id: id }); }
  finalizeScopeRecord(id: string, f: FileRecord) { return this.rpc<BaScope>('ba_scope_finalize_record', fileArgs(id, f)); }
  scopeFile(id: string) { return this.rpc<StoredFile>('ba_scope_file', { p_id: id }); }

  leads(i: { search?: string; temperature?: string; callStatus?: string; source?: string; page: number; pageSize: number }) {
    return this.rpc<TelecallerLeadList>('ba_leads_list', { p_search: i.search || null, p_temperature: i.temperature ?? null, p_call_status: i.callStatus ?? null, p_source: i.source || null, p_page: i.page, p_page_size: i.pageSize });
  }
  lead(id: string) { return this.rpc<TelecallerLead>('ba_lead_get', { p_id: id }); }
  saveLead(id: string | null, fields: Record<string, unknown>, services: string[] | null, temperature: string, callStatus: string) {
    return this.rpc<TelecallerLead>('ba_lead_save', { p_id: id, p_fields: fields, p_services: services, p_temperature: temperature, p_call_status: callStatus });
  }
}

export interface FileRecord { bucket: string; path: string; provider: string; reference: string; etag: string | null; size: number }
export interface StoredFile { bucket: string; path: string; provider: string | null; fileName: string }
const fileArgs = (id: string, f: FileRecord) => ({ p_id: id, p_bucket: f.bucket, p_path: f.path, p_provider: f.provider, p_ref: f.reference, p_etag: f.etag, p_size: f.size });

export interface ResearchBegin {
  cached: BaClientResearch | null;
  key?: string;
  business?: string;
  city?: string | null;
  businessCategory?: string | null;
  website?: string | null;
  industry?: string | null;
  tavilyPaused?: boolean;
}
export interface ScopeContext {
  contactId: string;
  client: { name: string; company: string | null; address: string | null; city: string | null; businessCategory: string | null; leadSource: string | null; notes: string | null };
  requirements: string | null;
  profile: Record<string, string>;
  services: { code: string; name: string; category: string }[];
  catalogue: { code: string; name: string; category: string }[];
  communicationNotes: string[];
  quotation: { number: string; revision: number; total: number; gstApplicable: boolean; services: string[] } | null;
  demos: { title: string; status: string; feedback: string | null; followUpNotes: string | null }[];
  previousVersions: { version: number; status: string }[];
}
