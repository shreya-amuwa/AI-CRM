import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { PROFILE_FIELDS, SCOPE_SECTION_LABELS, type ScopeContent, type QuotationContent } from '../../shared/baContent.js';
import type { BaQuotation, BaScope } from '../../shared/contracts.js';
import { inr, rs } from '../../shared/invoiceCalc.js';
import { INVOICE_IMAGES } from '../invoices/assets.js';
import { winAnsi } from '../invoices/pdf.js';

/**
 * The PDFs of a finalised quotation and a finalised Scope of Project, drawn from the stored snapshot only (never from what a browser sends).
 * Amuwa Corporation branding: the company logo of the invoice stationery and the company name. No registration number, GSTIN, bank details
 * or address is printed: none is invented here. The same snapshot gives the same bytes (fixed dates), so a retry never makes a different file.
 */
const W = 595.28;
const H = 841.89;
const MX = 44;
const TOP = 78;
const BOTTOM = 56;
const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.4, 0.42, 0.47);
const NAVY = rgb(0.043, 0.122, 0.294);
const BLUE = rgb(0.18, 0.36, 0.92);
const RULE = rgb(0.84, 0.86, 0.9);
const WASH = rgb(0.94, 0.96, 0.99);
const AMBER = rgb(0.72, 0.4, 0.04);

const money = (n: number | null | undefined) => rs(Math.round((Number(n) || 0) * 100));
/** Table cells: the figure alone (the table says the amounts are in rupees). */
const fig = (n: number | null | undefined) => inr(Math.round((Number(n) || 0) * 100));
const dateText = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-';

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(readonly doc: PDFDocument, readonly font: PDFFont, readonly bold: PDFFont, private logo: PDFImage | null, private readonly label: string, private readonly ref: string) {
    this.newPage();
  }
  clean(s: string, f = this.font) { return winAnsi(f, s ?? ''); }
  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    if (this.logo) {
      const h = 30;
      this.page.drawImage(this.logo, { x: MX, y: H - 24 - h, width: (this.logo.width / this.logo.height) * h, height: h });
    }
    this.page.drawText('Amuwa Corporation', { x: MX + 46, y: H - 40, size: 13, font: this.bold, color: NAVY });
    const lab = this.clean(this.label, this.font);
    this.page.drawText(lab, { x: W - MX - this.font.widthOfTextAtSize(lab, 9), y: H - 38, size: 9, font: this.font, color: MUTED });
    this.page.drawLine({ start: { x: MX, y: H - 62 }, end: { x: W - MX, y: H - 62 }, thickness: 1.2, color: BLUE });
    this.y = H - TOP - 8;
  }
  need(h: number) { if (this.y - h < BOTTOM) this.newPage(); }
  space(n = 8) { this.y -= n; }
  wrap(s: string, f: PDFFont, size: number, maxW: number): string[] {
    const out: string[] = [];
    for (const para of winAnsi(f, (s ?? '').replace(/\r\n?/g, '\n'), true).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/).filter(Boolean)) {
        let w = word;
        while (f.widthOfTextAtSize(w, size) > maxW) { // a word longer than the line
          let cut = w.length;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const cand = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(cand, size) <= maxW) line = cand;
        else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  }
  text(s: string, o: { size?: number; bold?: boolean; color?: RGB; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const f = o.bold ? this.bold : this.font;
    const x = o.x ?? MX;
    const lines = this.wrap(s, f, size, o.width ?? W - MX - x);
    for (const l of lines) {
      this.need(size + 4);
      this.page.drawText(l, { x, y: this.y - size, size, font: f, color: o.color ?? INK });
      this.y -= size + 4;
    }
    this.y -= o.gap ?? 2;
  }
  title(s: string, sub?: string) {
    this.text(s, { size: 20, bold: true, color: NAVY, gap: 0 });
    if (sub) this.text(sub, { size: 10, color: MUTED, gap: 4 });
  }
  h(s: string) {
    this.need(72); // a heading never sits alone at the foot of a page
    this.space(8);
    this.text(s, { size: 12.5, bold: true, color: NAVY, gap: 1 });
    this.page.drawLine({ start: { x: MX, y: this.y + 1 }, end: { x: W - MX, y: this.y + 1 }, thickness: 0.6, color: RULE });
    this.space(4);
  }
  h3(s: string) { this.need(24); this.space(3); this.text(s, { size: 10.5, bold: true, color: INK, gap: 1 }); }
  bullets(list: string[], o: { marks?: (string | null)[] } = {}) {
    list.forEach((item, i) => {
      const mark = o.marks?.[i];
      const size = 10;
      const lines = this.wrap(item, this.font, size, W - 2 * MX - 14);
      this.need((size + 4) * Math.min(lines.length, 2));
      this.page.drawCircle({ x: MX + 4, y: this.y - size + 3.5, size: 1.6, color: BLUE });
      lines.forEach((l, j) => {
        this.need(size + 4);
        this.page.drawText(l, { x: MX + 14, y: this.y - size, size, font: this.font, color: INK });
        if (j === lines.length - 1 && mark) {
          this.page.drawText(this.clean(` [${mark}]`), { x: MX + 14 + this.font.widthOfTextAtSize(l, size), y: this.y - size, size: 8, font: this.bold, color: AMBER });
        }
        this.y -= size + 4;
      });
    });
    this.y -= 2;
  }
  kv(rows: [string, string | null | undefined][]) {
    for (const [k, v] of rows) {
      if (!v) continue;
      const lines = this.wrap(v, this.font, 10, W - 2 * MX - 150);
      this.need(Math.max(14, lines.length * 14));
      this.page.drawText(this.clean(k, this.bold), { x: MX, y: this.y - 10, size: 9, font: this.bold, color: MUTED });
      lines.forEach((l, i) => this.page.drawText(l, { x: MX + 150, y: this.y - 10 - i * 14, size: 10, font: this.font, color: INK }));
      this.y -= Math.max(16, lines.length * 14 + 2);
    }
  }
  table(cols: { title: string; w: number; right?: boolean }[], rows: string[][], o: { totalsRow?: boolean } = {}) {
    const size = 9;
    const xs = cols.reduce<number[]>((a, c, i) => [...a, i === 0 ? MX : a[i - 1] + cols[i - 1].w], []);
    const head = () => {
      this.need(24);
      this.page.drawRectangle({ x: MX, y: this.y - 18, width: cols.reduce((n, c) => n + c.w, 0), height: 18, color: WASH });
      cols.forEach((c, i) => {
        const t = this.clean(c.title, this.bold);
        this.page.drawText(t, { x: c.right ? xs[i] + c.w - 4 - this.bold.widthOfTextAtSize(t, 8) : xs[i] + 4, y: this.y - 12, size: 8, font: this.bold, color: NAVY });
      });
      this.y -= 18;
    };
    head();
    rows.forEach((row, ri) => {
      const cells = row.map((cell, i) => this.wrap(cell, this.font, size, cols[i].w - 8));
      const h = Math.max(...cells.map(c => c.length)) * (size + 3) + 6;
      if (this.y - h < BOTTOM) { this.newPage(); head(); }
      const last = o.totalsRow && ri === rows.length - 1;
      cells.forEach((lines, i) =>
        lines.forEach((l, j) => {
          const f = last ? this.bold : this.font;
          const x = cols[i].right ? xs[i] + cols[i].w - 4 - f.widthOfTextAtSize(l, size) : xs[i] + 4;
          this.page.drawText(l, { x, y: this.y - 3 - size - j * (size + 3), size, font: f, color: INK });
        })
      );
      this.y -= h;
      this.page.drawLine({ start: { x: MX, y: this.y }, end: { x: MX + cols.reduce((n, c) => n + c.w, 0), y: this.y }, thickness: 0.4, color: RULE });
    });
    this.y -= 6;
  }
  footers() {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: MX, y: 40 }, end: { x: W - MX, y: 40 }, thickness: 0.5, color: RULE });
      p.drawText(this.clean(`Amuwa Corporation  |  ${this.ref}`), { x: MX, y: 28, size: 8, font: this.font, color: MUTED });
      const t = `Page ${i + 1} of ${n}`;
      p.drawText(t, { x: W - MX - this.font.widthOfTextAtSize(t, 8), y: 28, size: 8, font: this.font, color: MUTED });
    });
  }
}

async function start(label: string, ref: string, title: string, issuedAt: string) {
  const doc = await PDFDocument.create();
  const when = new Date(issuedAt.length === 10 ? `${issuedAt}T05:30:00Z` : issuedAt);
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  doc.setProducer('Amuwa CRM');
  doc.setCreator('Amuwa CRM');
  doc.setTitle(winAnsi(await doc.embedFont(StandardFonts.Helvetica), title));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const src = INVOICE_IMAGES.star;
  let logo: PDFImage | null = null;
  try {
    const bytes = Uint8Array.from(Buffer.from(src.base64, 'base64'));
    logo = src.format === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    logo = null; // the file is still correct without the picture
  }
  return new Writer(doc, font, bold, logo, label, ref);
}

// ---------------------------------------------------------------------------
// Quotation
// ---------------------------------------------------------------------------
export async function renderQuotationPdf(q: BaQuotation & { issuedOn?: string | null }): Promise<Uint8Array> {
  const c = (q.content || {}) as Partial<QuotationContent>;
  const issued = q.issuedOn || q.finalizedAt || new Date().toISOString().slice(0, 10);
  const w = await start('QUOTATION', `${q.number} (revision ${q.revision})`, `Quotation ${q.number}`, issued);
  w.title('Quotation', `${q.number}  |  Revision ${q.revision}`);
  w.space(4);
  w.kv([
    ['Date', dateText(issued)],
    ['Valid until', q.validityDays ? `${q.validityDays} days from the date of issue` : null],
    ['Prepared for', [q.client.company, q.client.name].filter(Boolean).join(' - ')],
    ['Client contact', [q.client.phone, q.client.email].filter(Boolean).join('   ')],
    ['Business address', q.client.address || q.client.city],
    ['Prepared by', q.createdBy]
  ]);
  if (c.introduction) { w.h('Introduction'); w.text(c.introduction); }
  if (c.understanding) { w.h('Understanding of your requirements'); w.text(c.understanding); }
  if (c.recommendedServices) { w.h('Recommended services'); w.text(c.recommendedServices); }
  w.h('Services and pricing');
  w.text('All amounts are in Indian rupees (Rs.).', { size: 8.5, color: MUTED });
  const gst = q.gstApplicable;
  const cols = gst
    ? [{ title: 'No.', w: 24 }, { title: 'Service', w: 139 }, { title: 'Qty', w: 30, right: true }, { title: 'Unit price', w: 64, right: true }, { title: 'Disc.', w: 32, right: true }, { title: 'Taxable', w: 64, right: true }, { title: 'GST %', w: 34, right: true }, { title: 'GST', w: 54, right: true }, { title: 'Total', w: 54, right: true }]
    : [{ title: 'No.', w: 28 }, { title: 'Service', w: 223 }, { title: 'Qty', w: 40, right: true }, { title: 'Unit price', w: 76, right: true }, { title: 'Disc.', w: 40, right: true }, { title: 'Total', w: 92, right: true }];
  const rows = q.items.map(it => {
    const name = [it.name, c.serviceDescriptions?.[it.serviceCode] || it.description].filter(Boolean).join(' - ');
    const base = [String(it.position), name, String(it.quantity), fig(it.unitPrice), it.discountPct ? `${it.discountPct}%` : '-'];
    return gst ? [...base, fig(it.taxable), `${it.gstRate}%`, fig(it.gst), fig(it.total)] : [...base, fig(it.total)];
  });
  w.table(cols, rows);
  w.need(90);
  const totals: [string, string][] = [['Subtotal', money(q.subtotal)]];
  if (q.discountTotal > 0) totals.push(['Discount', `- ${money(q.discountTotal)}`]);
  if (gst) { totals.push(['Taxable amount', money(q.taxableTotal)], ['GST', money(q.taxTotal)]); }
  totals.push([gst ? 'Total (including GST)' : 'Total (GST not applied)', money(q.total)]);
  for (const [k, v] of totals) {
    w.need(18);
    const last = k.startsWith('Total (');
    const f = last ? w.bold : w.font;
    w.page.drawText(w.clean(k, f), { x: W - MX - 240, y: w.y - 12, size: last ? 11 : 10, font: f, color: last ? NAVY : INK });
    const t = w.clean(v, f);
    w.page.drawText(t, { x: W - MX - f.widthOfTextAtSize(t, last ? 11 : 10), y: w.y - 12, size: last ? 11 : 10, font: f, color: last ? NAVY : INK });
    w.y -= 18;
  }
  if (c.scopeSummary) { w.h('Scope summary'); w.text(c.scopeSummary); }
  w.h('Commercial terms');
  w.kv([['Payment terms', q.paymentTerms], ['Validity', q.validityDays ? `${q.validityDays} days` : null], ['Timeline', q.timeline]]);
  if (c.commercialTerms) w.text(c.commercialTerms);
  if (c.implementationTimeline && c.implementationTimeline !== q.timeline) { w.h3('Implementation timeline'); w.text(c.implementationTimeline); }
  if (c.exclusions?.length) { w.h('Exclusions'); w.bullets(c.exclusions); }
  const notes = [...(c.notes || []), ...(q.notes ? [q.notes] : [])];
  if (notes.length) { w.h('Notes'); w.bullets(notes); }
  w.space(10);
  w.text('This is a quotation, not an invoice. It does not request or confirm any payment.', { size: 8.5, color: MUTED });
  w.footers();
  return w.doc.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------------------
// Scope of Project
// ---------------------------------------------------------------------------
export async function renderScopePdf(s: BaScope & { issuedOn?: string | null; serviceNames?: Record<string, string>; client: { name: string; company: string | null } }): Promise<Uint8Array> {
  const c = (s.content || {}) as Partial<ScopeContent>;
  const inputs = (s.inputs || {}) as Record<string, string>;
  const issued = s.issuedOn || s.finalizedAt || new Date().toISOString().slice(0, 10);
  const w = await start('SCOPE OF PROJECT', `${s.client.company || s.client.name}  |  Version ${s.version}`, `${s.title} - version ${s.version}`, issued);
  w.title(s.title || 'Scope of Project', `${s.client.company || s.client.name}  |  Version ${s.version}  |  ${dateText(issued)}`);
  w.space(2);
  w.kv([['Client', s.client.name], ['Company', s.client.company], ['Prepared by', s.createdBy], ['Status', 'Final'], ['Basis', s.aiGenerated ? 'Drafted with AI assistance; reviewed and finalised by the Business Associate' : 'Written by the Business Associate']]);

  const profile = (group: 'A' | 'B') => PROFILE_FIELDS.filter(f => f.group === group).map(f => [f.label, inputs[f.key]] as [string, string | undefined]);
  if (profile('A').some(([, v]) => v)) { w.h('A. Client and business profile'); w.kv(profile('A')); }
  if (profile('B').some(([, v]) => v)) { w.h('B. Current business situation'); w.kv(profile('B')); }

  const ba = c.businessAnalysis;
  if (ba) {
    w.h('C. Business analysis');
    w.text('Points marked [Assumption] are assessments made from the information available and are not confirmed facts.', { size: 8.5, color: MUTED });
    const group = (title: string, list?: { text: string; basis: string }[]) => {
      if (!list?.length) return;
      w.h3(title);
      w.bullets(list.map(i => i.text), { marks: list.map(i => (i.basis === 'VERIFIED' ? null : 'Assumption')) });
    };
    group('Strengths', ba.swot?.strengths);
    group('Weaknesses', ba.swot?.weaknesses);
    group('Opportunities', ba.swot?.opportunities);
    group('Threats', ba.swot?.threats);
    group('Key business challenges', ba.keyChallenges);
    group('Potential growth areas', ba.growthAreas);
    group('Areas requiring improvement', ba.improvementAreas);
  }
  if (c.recommendedSolutions?.length) {
    w.h('D. Recommended solutions');
    for (const r of c.recommendedSolutions) {
      w.h3(s.serviceNames?.[r.serviceCode] || r.serviceCode);
      w.kv([['Why', r.reason], ['Expected benefits', r.benefits], ['Integrations', r.integrations], ['Dependencies', r.dependencies], ['Considerations', r.considerations]]);
    }
  }
  const p = c.projectScope;
  if (p) {
    w.h('E. Project scope');
    const block = (title: string, v?: string) => { if (v) { w.h3(title); w.text(v); } };
    const list = (title: string, v?: string[]) => { if (v?.length) { w.h3(title); w.bullets(v); } };
    block('Project overview', p.overview);
    list('Client objectives', p.objectives);
    list('Current challenges', p.challenges);
    block('Proposed solution', p.proposedSolution);
    list('Services included', p.servicesIncluded);
    list('Deliverables', p.deliverables);
    list('Functional requirements', p.functionalRequirements);
    if (p.phases?.length) {
      w.h3('Implementation phases (proposed)');
      w.table([{ title: 'Phase', w: 140 }, { title: 'Duration', w: 90 }, { title: 'Activities', w: 265 }], p.phases.map(ph => [ph.name, ph.duration || '-', (ph.activities || []).join('; ') || '-']));
    }
    if (p.milestones?.length) {
      w.h3('Timeline and milestones (proposed)');
      w.table([{ title: 'Milestone', w: 330 }, { title: 'Timing', w: 165 }], p.milestones.map(m => [m.name, m.timing || '-']));
    }
    list('Client responsibilities', p.clientResponsibilities);
    list('Amuwa Corporation responsibilities', p.amuwaResponsibilities);
    list('Assumptions', p.assumptions);
    list('Dependencies', p.dependencies);
    list('Out-of-scope items', p.outOfScope);
    if (p.risks?.length) {
      w.h3('Risks and mitigation');
      w.table([{ title: 'Risk', w: 230 }, { title: 'Mitigation', w: 265 }], p.risks.map(r => [r.risk, r.mitigation || '-']));
    }
    list('Success metrics and KPIs', p.kpis);
    list('Next steps', p.nextSteps);
  }
  if (c.missingInformation?.length) { w.h('Information still to be confirmed'); w.bullets(c.missingInformation); }
  w.space(10);
  w.text(`${SCOPE_SECTION_LABELS.businessAnalysis} and recommendations are proposals for discussion. Timelines are indicative until confirmed in writing.`, { size: 8.5, color: MUTED });
  w.footers();
  return w.doc.save({ useObjectStreams: false });
}
