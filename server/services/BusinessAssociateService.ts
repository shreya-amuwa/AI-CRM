import { z } from 'zod';
import type {
  BaAssignee, BaContactDetail, BaContactList, BaDemo, BaHome, BaQuotation, BaQuotationRow, BaScope, BaScopeRow, ClientDocumentUrl, ServicePrice, TelecallerLead, TelecallerLeadList
} from '../../shared/contracts.js';
import { quotationContentSchema, scopeContentSchema, type ScopeSection } from '../../shared/baContent.js';
import {
  baAiExtraSchema, baContactUpdateSchema, baContactsQuerySchema, baConvertSchema, baDemoCreateSchema, baDemoStatusSchema, baDemoUpdateSchema, baDemosQuerySchema,
  baDocumentFileQuerySchema, baNoteSchema, baQuotationCreateSchema, baQuotationSchema, baReassignSchema, baScopeAiSchema, baScopeCreateSchema, baScopeSchema, servicePriceSchema,
  telecallerLeadSchema, telecallerLeadUpdateSchema, telecallerLeadsQuerySchema, uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { baAiSettings, callAiJson, checkAnswer, QUOTATION_SYSTEM, SCOPE_SYSTEM } from '../ba/ai.js';
// pdf-lib is loaded only when a quotation / scope PDF is drawn, not on every start of the API.
const baPdf = () => import('../ba/pdf.js');
import type { BusinessAssociateRepository } from '../repositories/BusinessAssociateRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const BUCKET = 'ba-documents';
const FILE_URL_TTL_SECONDS = 120;
const serviceCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.');
const followUpAt = (date: string | null | undefined) => (date === undefined ? undefined : date ? `${date}T09:00:00+05:30` : null);

/**
 * Business Associate: contacts handed over by Telecallers, quotations, demos and Scope of Project documents.
 * The database decides who may see or change anything; this layer validates input, asks the AI to write TEXT only (the database works out every
 * amount), draws the PDFs from the stored snapshot and stores them privately.
 */
export class BusinessAssociateService {
  constructor(private readonly repo: BusinessAssociateRepository, private readonly storage: StorageRepository) {}

  home(): Promise<BaHome> { return this.repo.home(); }
  assignees(): Promise<BaAssignee[]> { return this.repo.assignees(); }
  convertLead(leadId: unknown, body: unknown) {
    const i = parse(baConvertSchema, body ?? {});
    return this.repo.convertLead(parse(uuidSchema, leadId), i.assigneeId ?? null, i.note ?? null);
  }
  reassign(contactId: unknown, body: unknown) { return this.repo.reassign(parse(uuidSchema, contactId), parse(baReassignSchema, body).assigneeId); }

  // ---- contacts (Tasks)
  contacts(query: unknown): Promise<BaContactList> { return this.repo.contacts(parse(baContactsQuerySchema, query)); }
  contact(id: unknown): Promise<BaContactDetail> { return this.repo.contact(parse(uuidSchema, id)); }
  updateContact(id: unknown, body: unknown): Promise<BaContactDetail> {
    const { requirements, profile, nextFollowUp, stage } = parse(baContactUpdateSchema, body);
    const fields: Record<string, unknown> = {};
    if (requirements !== undefined) fields.requirements = requirements;
    if (profile !== undefined) fields.profile = profile;
    if (nextFollowUp !== undefined) fields.nextFollowUp = nextFollowUp;
    if (stage !== undefined) fields.stage = stage;
    return this.repo.updateContact(parse(uuidSchema, id), fields);
  }
  addNote(id: unknown, body: unknown) { return this.repo.addNote(parse(uuidSchema, id), parse(baNoteSchema, body).note); }

  // ---- price list
  prices(): Promise<ServicePrice[]> { return this.repo.prices(); }
  savePrice(code: unknown, body: unknown) {
    const c = parse(serviceCodeSchema, code);
    return this.repo.savePrice(c, parse(servicePriceSchema, body));
  }

  // ---- quotations
  quotations(query: unknown): Promise<BaQuotationRow[]> {
    const q = (query ?? {}) as Record<string, unknown>;
    return this.repo.quotations(q.contactId ? parse(uuidSchema, q.contactId) : undefined);
  }
  quotation(id: unknown): Promise<BaQuotation> { return this.repo.quotation(parse(uuidSchema, id)); }
  createQuotation(body: unknown): Promise<BaQuotation> {
    const { contactId, ...rest } = parse(baQuotationCreateSchema, body);
    return this.repo.saveQuotation(null, contactId, rest);
  }
  updateQuotation(id: unknown, body: unknown): Promise<BaQuotation> { return this.repo.saveQuotation(parse(uuidSchema, id), null, parse(baQuotationSchema, body)); }
  reviewQuotation(id: unknown) { return this.repo.reviewQuotation(parse(uuidSchema, id)); }
  reviseQuotation(id: unknown) { return this.repo.reviseQuotation(parse(uuidSchema, id)); }

  /** The AI drafts the words of the quotation. The lines, prices, tax and totals are fixed (worked out by the database) and are not the AI's to change. */
  async aiQuotation(id: unknown, body: unknown): Promise<BaQuotation> {
    const quotationId = parse(uuidSchema, id);
    const { instructions } = parse(baAiExtraSchema, body ?? {});
    const q = await this.repo.quotation(quotationId);
    if (q.status === 'FINAL') throw new AppError('CONFLICT', 'A finalised quotation cannot be changed. Create a new revision instead.');
    const payload = {
      client: { company: q.client.company, name: q.client.name, city: q.client.city, businessCategory: q.client.businessCategory },
      requirements: q.requirements,
      businessProfile: q.businessProfile,
      lines: q.items.map(i => ({ code: i.serviceCode, service: i.name, unit: i.unitLabel, quantity: i.quantity, unitPrice: i.unitPrice, discountPct: i.discountPct, lineTotal: i.total, note: i.description })),
      totals: { subtotal: q.subtotal, discountTotal: q.discountTotal, tax: q.taxTotal, total: q.total, gstApplicable: q.gstApplicable },
      paymentTerms: q.paymentTerms, validityDays: q.validityDays, timeline: q.timeline, notes: q.notes,
      extraInstructions: instructions ?? null
    };
    const ai = await callAiJson(baAiSettings(), QUOTATION_SYSTEM, payload, 4000);
    const content = checkAnswer(quotationContentSchema, ai.data);
    const codes = new Set(q.items.map(i => i.serviceCode));
    content.serviceDescriptions = Object.fromEntries(Object.entries(content.serviceDescriptions).filter(([k]) => codes.has(k)));
    return this.repo.saveQuotation(quotationId, null, { content, aiGenerated: true, aiModel: ai.model });
  }

  /** "Generate PDF": the database checks the quotation may be finalised, the PDF is drawn from its stored snapshot and stored privately, then it becomes final. */
  async finalizeQuotation(id: unknown): Promise<BaQuotation> {
    const quotationId = parse(uuidSchema, id);
    const snap = await this.repo.finalizeQuotationBegin(quotationId);
    const bytes = await (await baPdf()).renderQuotationPdf(snap);
    const path = `${snap.departmentId}/${snap.contactId}/quotation-${snap.number}-r${snap.revision}.pdf`;
    const file = await this.storage.storeGenerated(BUCKET, path, bytes, 'application/pdf');
    return this.repo.finalizeQuotationRecord(quotationId, { bucket: BUCKET, path, provider: file.provider, reference: file.reference, etag: file.etag, size: file.size });
  }

  async quotationFileUrl(id: unknown, query: unknown): Promise<ClientDocumentUrl> {
    const q = parse(baDocumentFileQuerySchema, query ?? {});
    const f = await this.repo.quotationFile(parse(uuidSchema, id));
    const url = await this.storage.signedDownloadUrl(f.bucket, f.path, FILE_URL_TTL_SECONDS, q.action === 'download' ? f.fileName : undefined, f.provider as 'R2' | 'SUPABASE' | null);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: f.fileName };
  }

  // ---- demos
  demos(query: unknown): Promise<BaDemo[]> { return this.repo.demos(parse(baDemosQuerySchema, query ?? {})); }
  createDemo(body: unknown): Promise<BaDemo> {
    const { contactId, ...rest } = parse(baDemoCreateSchema, body);
    return this.repo.saveDemo(null, contactId, rest);
  }
  updateDemo(id: unknown, body: unknown): Promise<BaDemo> { return this.repo.saveDemo(parse(uuidSchema, id), null, parse(baDemoUpdateSchema, body)); }
  demoStatus(id: unknown, body: unknown): Promise<BaDemo> {
    const i = parse(baDemoStatusSchema, body);
    return this.repo.demoStatus(parse(uuidSchema, id), i.status, i.feedback, i.followUpNotes);
  }

  // ---- scope of project
  scopes(contactId: unknown): Promise<BaScopeRow[]> { return this.repo.scopes(parse(uuidSchema, contactId)); }
  scope(id: unknown): Promise<BaScope> { return this.repo.scope(parse(uuidSchema, id)); }
  async createScope(body: unknown): Promise<BaScope> {
    const { contactId, ...rest } = parse(baScopeCreateSchema, body);
    const doc = await this.repo.saveScope(null, contactId, rest);
    if (rest.inputs) await this.repo.updateContact(contactId, { profile: rest.inputs });
    return doc;
  }
  async updateScope(id: unknown, body: unknown): Promise<BaScope> {
    const scopeId = parse(uuidSchema, id);
    const data = parse(baScopeSchema, body);
    const doc = await this.repo.saveScope(scopeId, null, data);
    if (data.inputs) await this.repo.updateContact(doc.contactId, { profile: data.inputs }); // quotations and scopes read the same facts
    return doc;
  }
  reviewScope(id: unknown) { return this.repo.reviewScope(parse(uuidSchema, id)); }

  /**
   * The AI writes the business analysis, the recommendations and the project scope from this client's own data and the approved service
   * catalogue. With "section" it rewrites that part only. Recommendations for services outside the catalogue are dropped.
   */
  async aiScope(id: unknown, body: unknown): Promise<BaScope> {
    const scopeId = parse(uuidSchema, id);
    const { instructions, section } = parse(baScopeAiSchema, body ?? {});
    const doc = await this.repo.scope(scopeId);
    if (doc.status === 'FINAL') throw new AppError('CONFLICT', 'A finalised version cannot be changed. Start a new version instead.');
    const ctx = await this.repo.scopeContext(doc.contactId);
    const payload = {
      client: ctx.client, requirements: ctx.requirements, profile: ctx.profile, inputs: doc.inputs, services: ctx.services, catalogue: ctx.catalogue,
      communicationNotes: ctx.communicationNotes, quotation: ctx.quotation, demos: ctx.demos,
      section: section ?? null,
      currentDocument: section ? doc.content : null,
      extraInstructions: instructions ?? null
    };
    const ai = await callAiJson(baAiSettings(), SCOPE_SYSTEM, payload, 8000);
    const catalogue = new Set(ctx.catalogue.map(c => c.code));
    let content: Partial<typeof scopeContentSchema._type>;
    if (section) {
      const picked = scopeContentSchema.pick({ [section]: true } as Record<ScopeSection, true>).extend({ missingInformation: scopeContentSchema.shape.missingInformation });
      content = { ...(doc.content as object), ...checkAnswer(picked, ai.data) };
    } else {
      content = checkAnswer(scopeContentSchema, ai.data);
    }
    if (content.recommendedSolutions) content.recommendedSolutions = content.recommendedSolutions.filter(r => catalogue.has(r.serviceCode));
    if (section) content.missingInformation = [...new Set([...(((doc.content as { missingInformation?: string[] }).missingInformation) ?? []), ...(content.missingInformation ?? [])])].slice(0, 20);
    return this.repo.saveScope(scopeId, null, { content, aiGenerated: true, aiModel: ai.model });
  }

  async finalizeScope(id: unknown): Promise<BaScope> {
    const scopeId = parse(uuidSchema, id);
    const snap = await this.repo.finalizeScopeBegin(scopeId);
    const bytes = await (await baPdf()).renderScopePdf(snap);
    const path = `${snap.departmentId}/${snap.contactId}/scope-v${snap.version}.pdf`;
    const file = await this.storage.storeGenerated(BUCKET, path, bytes, 'application/pdf');
    return this.repo.finalizeScopeRecord(scopeId, { bucket: BUCKET, path, provider: file.provider, reference: file.reference, etag: file.etag, size: file.size });
  }

  async scopeFileUrl(id: unknown, query: unknown): Promise<ClientDocumentUrl> {
    const q = parse(baDocumentFileQuerySchema, query ?? {});
    const f = await this.repo.scopeFile(parse(uuidSchema, id));
    const url = await this.storage.signedDownloadUrl(f.bucket, f.path, FILE_URL_TTL_SECONDS, q.action === 'download' ? f.fileName : undefined, f.provider as 'R2' | 'SUPABASE' | null);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: f.fileName };
  }

  // ---- the Business Associate's own leads
  leads(query: unknown): Promise<TelecallerLeadList> { return this.repo.leads(parse(telecallerLeadsQuerySchema, query)); }
  lead(id: unknown): Promise<TelecallerLead> { return this.repo.lead(parse(uuidSchema, id)); }
  createLead(body: unknown): Promise<TelecallerLead> {
    const { services, leadTemperature, callStatus, followUpDate, ...fields } = parse(telecallerLeadSchema, body);
    return this.repo.saveLead(null, { ...fields, nextFollowUpAt: followUpAt(followUpDate) ?? null }, services, leadTemperature, callStatus);
  }
  updateLead(id: unknown, body: unknown): Promise<TelecallerLead> {
    const { services, leadTemperature, callStatus, followUpDate, ...fields } = parse(telecallerLeadUpdateSchema, body);
    const at = followUpAt(followUpDate);
    return this.repo.saveLead(parse(uuidSchema, id), { ...fields, ...(at !== undefined ? { nextFollowUpAt: at } : {}) }, services ?? null, leadTemperature, callStatus);
  }
}
