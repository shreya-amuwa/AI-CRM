import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChecklistItem,
  ReviewCounts,
  CustomerActivity,
  CustomerDocument,
  DocumentType,
  HandoverInfo,
  InboundLead,
  Paginated,
  PipelineCounts,
  PipelineCustomer,
  ServiceCatalogItem
} from '../../shared/contracts.js';
import type { LeadCreateInput, LeadUpdateInput, PipelineListQuery } from '../../shared/validation.js';
import { likePattern, pageRange, unwrap, unwrapOne } from './base.js';

const BASE_COLUMNS = `id, lifecycle_stage, lead_status, name, company, phone, whatsapp, email, city, business_category,
  lead_source, notes, next_follow_up_at, expected_budget, deal_amount, amount_received, payment_due_date,
  owner_id, team_id, department_id, stage_changed_at, created_at, updated_at,
  owner:profiles!customers_owner_id_fkey(id, full_name),
  services:customer_services(service_code),
  onboarding:customer_onboarding(stage, payment_method, started_at, target_handover_date, forwarded_to_support_at, returned_at, return_note, mandatory_saved,
    items_total, items_saved, items_verified, items_rejected, consultant_items_total, consultant_items_done,
    handover_stage, team_lead_id, team_member_id, to_department_head_at, passed_to_team_lead_at, assigned_to_member_at)`;

const SORTS: Record<PipelineListQuery['sort'], { column: string; ascending: boolean }> = {
  newest: { column: 'stage_changed_at', ascending: false },
  oldest: { column: 'stage_changed_at', ascending: true },
  followUp: { column: 'next_follow_up_at', ascending: true },
  dueDate: { column: 'payment_due_date', ascending: true },
  amount: { column: 'deal_amount', ascending: false },
  name: { column: 'company', ascending: true }
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function mapPipelineCustomer(r: any): PipelineCustomer {
  const o = one(r.onboarding) as any;
  return {
    id: r.id,
    lifecycleStage: r.lifecycle_stage,
    leadStatus: r.lead_status,
    name: r.name,
    company: r.company,
    phone: r.phone,
    whatsapp: r.whatsapp,
    email: r.email,
    city: r.city,
    businessCategory: r.business_category,
    leadSource: r.lead_source,
    notes: r.notes,
    nextFollowUpAt: r.next_follow_up_at,
    expectedBudget: num(r.expected_budget),
    dealAmount: num(r.deal_amount),
    amountReceived: Number(r.amount_received ?? 0),
    paymentDueDate: r.payment_due_date,
    services: (r.services || []).map((s: any) => s.service_code),
    owner: r.owner ? { id: r.owner.id, fullName: r.owner.full_name } : null,
    ownerId: r.owner_id,
    teamId: r.team_id,
    departmentId: r.department_id,
    stageChangedAt: r.stage_changed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    onboarding: o
      ? {
          stage: o.stage,
          paymentMethod: o.payment_method,
          startedAt: o.started_at,
          targetHandoverDate: o.target_handover_date,
          forwardedToSupportAt: o.forwarded_to_support_at,
          returnedAt: o.returned_at ?? null,
          returnNote: o.return_note ?? null,
          mandatorySaved: o.mandatory_saved ?? 0,
          itemsTotal: o.items_total ?? 0,
          itemsSaved: o.items_saved ?? 0,
          itemsVerified: o.items_verified ?? 0,
          itemsRejected: o.items_rejected ?? 0,
          consultantItemsTotal: o.consultant_items_total ?? 0,
          consultantItemsDone: o.consultant_items_done ?? 0,
          handoverStage: o.handover_stage ?? 'CONSULTANT',
          teamLeadId: o.team_lead_id ?? null,
          teamMemberId: o.team_member_id ?? null,
          toDepartmentHeadAt: o.to_department_head_at ?? null,
          passedToTeamLeadAt: o.passed_to_team_lead_at ?? null,
          assignedToMemberAt: o.assigned_to_member_at ?? null
        }
      : null
  };
}

export function mapDocument(r: any): CustomerDocument {
  return {
    id: r.id,
    customerId: r.customer_id,
    documentType: r.document_type,
    version: r.version,
    status: r.status,
    originalFileName: r.original_file_name,
    mimeType: r.mime_type,
    sizeBytes: num(r.size_bytes),
    uploadedBy: r.uploader ? { id: r.uploader.id, fullName: r.uploader.full_name } : null,
    uploadedAt: r.uploaded_at,
    createdAt: r.created_at
  };
}

/** Lead fields (camelCase) → JSON payload consumed by create_lead / update_lead. */
function leadPayload(input: Partial<LeadCreateInput> & { activityNote?: string | null }) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined && k !== 'services') out[k] = v;
  }
  return out;
}

const DOCUMENT_COLUMNS = `id, customer_id, document_type, version, status, original_file_name, mime_type, size_bytes,
  uploaded_at, created_at, uploader:profiles!customer_documents_uploaded_by_fkey(id, full_name)`;

/** Data access for the sales pipeline. All queries run as the caller (RLS). */
export class PipelineRepository {
  constructor(private readonly db: SupabaseClient) {}

  async services(): Promise<ServiceCatalogItem[]> {
    const rows = unwrap(await this.db.from('crm_services').select('code, name, category').eq('is_active', true).order('sort_order'));
    return rows as ServiceCatalogItem[];
  }

  async checklist(customerId: string): Promise<ChecklistItem[]> {
    return unwrap(await this.db.rpc('customer_onboarding_checklist', { p_customer: customerId })) as ChecklistItem[];
  }

  async reviewCounts(): Promise<ReviewCounts> {
    return unwrap(await this.db.rpc('onboarding_review_counts')) as ReviewCounts;
  }

  async verifyAll(customerId: string): Promise<number> {
    return unwrap(await this.db.rpc('verify_all_onboarding_entries', { p_customer: customerId })) as number;
  }

  /** Latest run per automation for one customer. */
  async automationRuns(customerId: string) {
    const rows = unwrap(
      await this.db
        .from('onboarding_automation_runs')
        .select('automation, status, detail, triggered_at, triggerer:profiles!onboarding_automation_runs_triggered_by_fkey(full_name)')
        .eq('customer_id', customerId)
        .order('triggered_at', { ascending: false })
        .limit(30)
    ) as any[];
    const latest = new Map<string, any>();
    for (const r of rows) if (!latest.has(r.automation)) latest.set(r.automation, r);
    return latest;
  }

  async beginAutomation(customerId: string, automation: string): Promise<any> {
    return unwrap(await this.db.rpc('begin_onboarding_automation', { p_customer: customerId, p_automation: automation }));
  }

  async finishAutomation(runId: string, ok: boolean, detail: string): Promise<void> {
    unwrap(await this.db.rpc('finish_onboarding_automation', { p_run: runId, p_ok: ok, p_detail: detail }));
  }

  async ownerSummary(customerId: string): Promise<{ id: string; fullName: string } | null> {
    return (unwrap(await this.db.rpc('customer_owner_summary', { p_customer: customerId })) as any) ?? null;
  }

  async saveEntry(customerId: string, item: string, value: string): Promise<void> {
    unwrap(await this.db.rpc('save_onboarding_entry', { p_customer: customerId, p_item: item, p_value: value }));
  }

  async saveConsultantEntry(customerId: string, item: string, value: string): Promise<void> {
    unwrap(await this.db.rpc('save_consultant_entry', { p_customer: customerId, p_item: item, p_value: value }));
  }

  async reviewEntry(customerId: string, item: string, decision: 'VERIFIED' | 'REJECTED', note: string | null): Promise<void> {
    unwrap(await this.db.rpc('review_onboarding_entry', { p_customer: customerId, p_item: item, p_decision: decision, p_note: note }));
  }

  async documentTypes(): Promise<DocumentType[]> {
    const rows = unwrap(
      await this.db
        .from('document_types')
        .select('code, label, description, is_mandatory, allowed_mime_types, max_size_bytes')
        .order('sort_order')
    );
    return rows.map((r: any) => ({
      code: r.code,
      label: r.label,
      description: r.description,
      isMandatory: r.is_mandatory,
      allowedMimeTypes: r.allowed_mime_types,
      maxSizeBytes: Number(r.max_size_bytes)
    }));
  }

  async counts(): Promise<PipelineCounts> {
    return unwrap(await this.db.rpc('customer_pipeline_counts')) as PipelineCounts;
  }

  async list(q: PipelineListQuery, actorId: string): Promise<Paginated<PipelineCustomer>> {
    let columns = BASE_COLUMNS;
    if (q.service) columns += ', service_filter:customer_services!inner(service_code)';
    const needsOnboarding = q.onboarding || q.review || q.forwarded || q.handover || q.handoverMine;
    if (needsOnboarding) {
      columns += ', onboarding_filter:customer_onboarding!inner(onboarding_state, review_state, with_consultant, handover_stage, team_lead_id, team_member_id)';
    }

    let query = this.db.from('customers').select(columns, { count: 'exact' }).eq('lifecycle_stage', q.stage);
    if (q.mine) query = query.eq('owner_id', actorId);
    if (q.search) query = query.ilike('search_text', likePattern(q.search));
    if (q.service) query = query.eq('service_filter.service_code', q.service);
    if (q.source) query = query.eq('lead_source', q.source);
    if (q.leadStatus) query = query.eq('lead_status', q.leadStatus);
    if (q.noFollowUp) query = query.is('next_follow_up_at', null);
    if (q.followUpFrom) query = query.gte('next_follow_up_at', q.followUpFrom);
    if (q.followUpTo) query = query.lt('next_follow_up_at', q.followUpTo);

    const today = new Date().toISOString().slice(0, 10);
    // Same predicates as customer_pipeline_counts(); fully paid is never part paid or overdue.
    if (q.payment === 'AWAITING') query = query.eq('fully_paid', false).eq('amount_received', 0).gte('payment_due_date', today);
    if (q.payment === 'PART_PAID') query = query.eq('fully_paid', false).gt('amount_received', 0).gte('payment_due_date', today);
    if (q.payment === 'OVERDUE') query = query.eq('fully_paid', false).lt('payment_due_date', today);
    if (q.payment === 'PAID') query = query.eq('fully_paid', true);

    // Derived states are generated columns on customer_onboarding.
    // GET_STARTED: first payment received, balance still due (not an exclusive state).
    if (q.onboarding === 'GET_STARTED') query = query.eq('fully_paid', false);
    else if (q.onboarding) query = query.eq('onboarding_filter.onboarding_state', q.onboarding);
    // Consultant queue: sent to them, or sent back and waiting for sales.
    if (q.forwarded || q.review) query = query.eq('onboarding_filter.with_consultant', true);
    if (q.review) query = query.eq('onboarding_filter.review_state', q.review);
    if (q.handover) query = query.eq('onboarding_filter.handover_stage', q.handover);
    if (q.handoverMine) query = query.eq(q.handoverMine === 'TEAM_LEAD' ? 'onboarding_filter.team_lead_id' : 'onboarding_filter.team_member_id', actorId);

    const sort = SORTS[q.sort];
    const { data, error, count } = await query
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      .order('id')
      .range(...pageRange(q));
    const rows = unwrap({ data, error }) as any[];
    return { items: rows.map(mapPipelineCustomer), page: q.page, pageSize: q.pageSize, total: count ?? rows.length };
  }

  async get(id: string): Promise<PipelineCustomer> {
    return mapPipelineCustomer(unwrapOne(await this.db.from('customers').select(BASE_COLUMNS).eq('id', id).maybeSingle(), 'Customer'));
  }

  async documents(customerId: string): Promise<CustomerDocument[]> {
    const rows = unwrap(
      await this.db
        .from('customer_documents')
        .select(DOCUMENT_COLUMNS)
        .eq('customer_id', customerId)
        .in('status', ['UPLOADED', 'SUPERSEDED'])
        .order('document_type')
        .order('version', { ascending: false })
    );
    return rows.map(mapDocument);
  }

  async document(id: string): Promise<CustomerDocument> {
    return mapDocument(unwrapOne(await this.db.from('customer_documents').select(DOCUMENT_COLUMNS).eq('id', id).maybeSingle(), 'Document'));
  }

  async activities(customerId: string): Promise<CustomerActivity[]> {
    const rows = unwrap(
      await this.db
        .from('customer_activities')
        .select('id, customer_id, actor_id, type, note, occurred_at')
        .eq('customer_id', customerId)
        .order('occurred_at', { ascending: false })
        .limit(50)
    );
    return rows.map((r: any) => ({ id: r.id, customerId: r.customer_id, actorId: r.actor_id, type: r.type, note: r.note, occurredAt: r.occurred_at }));
  }

  async createLead(input: LeadCreateInput): Promise<string> {
    return unwrap(await this.db.rpc('create_lead', { p_fields: leadPayload(input), p_services: input.services })) as string;
  }

  async updateLead(id: string, input: LeadUpdateInput): Promise<void> {
    unwrap(await this.db.rpc('update_lead', { p_id: id, p_fields: leadPayload(input), p_services: input.services ?? null }));
  }

  async moveToPotential(id: string, dealAmount: number, dueDate: string): Promise<void> {
    unwrap(await this.db.rpc('move_customer_to_potential', { p_id: id, p_deal_amount: dealAmount, p_due_date: dueDate }));
  }

  async recordPayment(id: string, amount: number, method?: string): Promise<void> {
    unwrap(await this.db.rpc('record_customer_payment', { p_id: id, p_amount: amount, p_method: method ?? null }));
  }

  async assertClientAccountAllowed(customerId: string, email: string): Promise<void> {
    unwrap(await this.db.rpc('assert_client_account_allowed', { p_customer: customerId, p_email: email }));
  }

  async recordClientAccount(customerId: string, userId: string, email: string): Promise<void> {
    unwrap(await this.db.rpc('record_client_account', { p_customer: customerId, p_user_id: userId, p_email: email }));
  }

  async handoverInfo(customerId: string): Promise<HandoverInfo | null> {
    return (unwrap(await this.db.rpc('customer_handover_info', { p_customer: customerId })) as HandoverInfo | null) ?? null;
  }

  async sendToDepartmentHead(customerId: string, note: string | null): Promise<void> {
    unwrap(await this.db.rpc('send_to_department_head', { p_customer: customerId, p_note: note }));
  }

  async passToTeamLead(customerId: string, teamLeadId: string, note: string | null): Promise<void> {
    unwrap(await this.db.rpc('pass_to_team_lead', { p_customer: customerId, p_team_lead: teamLeadId, p_note: note }));
  }

  async assignToTeamMember(customerId: string, memberId: string, note: string | null): Promise<void> {
    unwrap(await this.db.rpc('assign_to_team_member', { p_customer: customerId, p_member: memberId, p_note: note }));
  }

  async backOut(id: string, reason: string | null): Promise<void> {
    unwrap(await this.db.rpc('back_out_customer', { p_id: id, p_reason: reason }));
  }

  async startOnboarding(id: string, amountReceived: number, method: string, targetHandover?: string | null): Promise<void> {
    unwrap(
      await this.db.rpc('start_customer_onboarding', {
        p_id: id,
        p_amount_received: amountReceived,
        p_payment_method: method,
        p_target_handover: targetHandover ?? null
      })
    );
  }

  async returnToSales(id: string, note: string | null): Promise<void> {
    unwrap(await this.db.rpc('return_onboarding_to_sales', { p_customer: id, p_note: note }));
  }

  async forwardToSupport(id: string): Promise<void> {
    unwrap(await this.db.rpc('forward_onboarding_to_support', { p_id: id }));
  }

  async updateOnboarding(id: string, targetHandoverDate: string | null): Promise<void> {
    const rows = unwrap(
      await this.db.from('customer_onboarding').update({ target_handover_date: targetHandoverDate }).eq('customer_id', id).select('customer_id')
    );
    if (!rows.length) unwrapOne({ data: null, error: null }, 'Onboarding');
  }

  async inbound(departmentSlug: string, actorId: string): Promise<InboundLead[]> {
    const rows = unwrap(
      await this.db
        .from('crm_leads')
        .select('id, name, phone, email, company, channel, created_at')
        .eq('department', departmentSlug)
        .or(`assigned_to.is.null,assigned_to.eq.${actorId}`)
        .is('converted_customer_id', null)
        .order('created_at', { ascending: false })
        .limit(50)
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      company: r.company,
      channel: r.channel,
      receivedAt: r.created_at
    }));
  }

  async departmentSlug(departmentId: string): Promise<string | null> {
    const row = unwrap(await this.db.from('departments').select('slug').eq('id', departmentId).maybeSingle()) as any;
    return row?.slug ?? null;
  }

  async claimInbound(leadId: string): Promise<string> {
    return unwrap(await this.db.rpc('claim_inbound_lead', { p_lead_id: leadId })) as string;
  }

  // ---- documents (state changes are database functions) ----
  async beginUpload(customerId: string, type: string, fileName: string, mime: string, size: number) {
    return unwrap(
      await this.db.rpc('begin_document_upload', {
        p_customer: customerId,
        p_type: type,
        p_file_name: fileName,
        p_mime: mime,
        p_size: size
      })
    ) as any;
  }

  async completeUpload(documentId: string, size: number) {
    return unwrap(await this.db.rpc('complete_document_upload', { p_document: documentId, p_size: size })) as any;
  }

  async failUpload(documentId: string): Promise<string> {
    return unwrap(await this.db.rpc('fail_document_upload', { p_document: documentId })) as string;
  }

  async pendingDocument(
    documentId: string
  ): Promise<{ id: string; storage_bucket: string; storage_path: string; document_type: string; status: string; mime_type: string } | null> {
    const row = unwrap(
      await this.db
        .from('customer_documents')
        .select('id, storage_bucket, storage_path, document_type, status, mime_type')
        .eq('id', documentId)
        .maybeSingle()
    ) as any;
    return row ?? null;
  }

  async authorizeAccess(documentId: string, action: 'VIEW' | 'DOWNLOAD') {
    const rows = unwrap(await this.db.rpc('authorize_document_access', { p_document: documentId, p_action: action })) as any[];
    return rows[0] as { storage_bucket: string; storage_path: string; original_file_name: string; mime_type: string };
  }

  async deleteDocument(documentId: string): Promise<string> {
    return unwrap(await this.db.rpc('delete_customer_document', { p_document: documentId })) as string;
  }
}
