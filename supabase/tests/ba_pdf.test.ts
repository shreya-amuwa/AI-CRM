/** The Business Associate's PDFs: real, deterministic, paginated, safe with odd text, and no invented company details. */
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { renderQuotationPdf, renderScopePdf } from '../../server/ba/pdf.js';
import type { BaQuotation, BaScope } from '../../shared/contracts.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}

const line = (n: number, gst: boolean) => ({ position: n, serviceCode: `SVC_${n}`, name: `Service number ${n}`, description: null, unitLabel: 'one time', quantity: 2, unitPrice: 5000, discountPct: 10, gstRate: gst ? 18 : 0, amount: 10000, discount: 1000, taxable: 9000, gst: gst ? 1620 : 0, total: gst ? 10620 : 9000 });
const quote = (gst: boolean, lines = 2): BaQuotation & { issuedOn: string } => ({
  id: 'q1', contactId: 'c1', number: 'QT-2026-00001', revision: 1, status: 'FINAL', total: gst ? 21240 : 18000, aiGenerated: true, reviewed: true, createdAt: '2026-10-01T05:00:00Z', updatedAt: '2026-10-01T05:00:00Z', finalizedAt: '2026-10-01T05:00:00Z',
  validUntil: '2026-10-31', hasPdf: false, createdBy: 'Biz One', items: Array.from({ length: lines }, (_v, i) => line(i + 1, gst)), gstApplicable: gst, subtotal: 20000, discountTotal: 2000, taxableTotal: 18000, taxTotal: gst ? 3240 : 0,
  validityDays: 30, paymentTerms: '50% advance, 50% on delivery', timeline: '3 weeks', notes: 'Prices are in INR.', aiModel: 'm', reviewedAt: '2026-10-01T05:00:00Z', priceFlags: [],
  content: { introduction: 'Dear Meera Kapoor Traders, thank you. ' + 'We are pleased to quote. '.repeat(30), understanding: 'Order updates on WhatsApp.', exclusions: ['Third-party fees'], notes: ['Note 1'], serviceDescriptions: { SVC_1: 'A description of the first service. ' + 'x'.repeat(10) } },
  client: { name: 'Meera Kapoor', company: 'Meera Kapoor Traders', phone: '9811234561', email: 'meera@example.com', address: '12 MG Road, Pune', city: 'Pune', businessCategory: null }, requirements: null, businessProfile: {}, issuedOn: '2026-10-01'
});

let b = await renderQuotationPdf(quote(true));
check(Buffer.from(b.subarray(0, 5)).toString() === '%PDF-', 'a quotation PDF is a real PDF');
let d = await PDFDocument.load(b);
check(/QT-2026-00001/.test(d.getTitle() || ''), 'a quotation carries its number in the PDF title', d.getTitle());
check(d.getPageCount() <= 2, 'a short quotation fits one or two pages', d.getPageCount());
const again = await renderQuotationPdf(quote(true));
check(Buffer.compare(Buffer.from(b), Buffer.from(again)) === 0, 'the same quotation gives the same bytes (a retry never makes a different file)');
check(Buffer.compare(Buffer.from(b), Buffer.from(await renderQuotationPdf(quote(false)))) !== 0, 'without GST the PDF differs (no tax column)');
const long = await renderQuotationPdf(quote(true, 40));
check((await PDFDocument.load(long)).getPageCount() >= 3, 'a quotation with 40 lines runs over several pages');
const odd = quote(true);
odd.content = { introduction: 'Hello नमस्ते “quoted” – dash ₹ 5,000 ' + 'a'.repeat(300), exclusions: ['Ünïcode ✓'] };
odd.client.company = 'Café Ünï ' + 'X'.repeat(120);
check((await renderQuotationPdf(odd)).length > 1000, 'text the standard fonts cannot draw, and a word longer than the line, do not break the PDF');
fs.writeFileSync(`${process.env.SAMPLE_DIR || '.'}/sample-quotation.pdf`, b);

const items = (n: number) => Array.from({ length: n }, (_v, i) => ({ text: `Point ${i + 1} about the business ` + 'detail '.repeat(12), basis: i % 2 ? 'ASSUMPTION' as const : 'VERIFIED' as const }));
const scope: BaScope & { issuedOn: string; serviceNames: Record<string, string>; client: { name: string; company: string | null } } = {
  id: 's1', contactId: 'c1', version: 2, status: 'FINAL', title: 'Scope of Project - Meera Kapoor Traders', aiGenerated: true, reviewed: true, createdAt: '2026-10-02T05:00:00Z', updatedAt: '2026-10-02T05:00:00Z', finalizedAt: '2026-10-02T05:00:00Z', hasPdf: false, createdBy: 'Biz One',
  inputs: { industry: 'Restaurants', location: 'Pune', operationalChallenges: 'Customers keep calling to ask about orders' }, aiModel: 'm', reviewedAt: '2026-10-02T05:00:00Z', issuedOn: '2026-10-02',
  serviceNames: { WA: 'WhatsApp API + Blue Tick' }, client: { name: 'Meera Kapoor', company: 'Meera Kapoor Traders' },
  content: {
    businessAnalysis: { swot: { strengths: items(4), weaknesses: items(3), opportunities: items(3), threats: items(2) }, keyChallenges: items(3), growthAreas: items(2), improvementAreas: items(2) },
    recommendedSolutions: [{ serviceCode: 'WA', reason: 'Stated requirement', benefits: 'Fewer calls', integrations: '', dependencies: 'A verified business', considerations: '' }],
    projectScope: {
      overview: 'Set up order updates. ' + 'More text. '.repeat(40), objectives: ['Fewer calls'], challenges: [], proposedSolution: 'WhatsApp API.', servicesIncluded: ['WhatsApp API + Blue Tick'], deliverables: ['Order updates live'], functionalRequirements: ['Send a message on each order status'],
      phases: [{ name: 'Setup', duration: 'about 2 weeks, to be confirmed', activities: ['Configure', 'Test'] }], milestones: [{ name: 'Go live', timing: 'Week 3 (proposed)' }], clientResponsibilities: ['Give access'], amuwaResponsibilities: ['Set up'],
      assumptions: ['Timelines are proposals'], dependencies: ['Business verification'], outOfScope: ['Design work'], risks: [{ risk: 'Delays in verification', mitigation: 'Start early' }], kpis: ['Calls reduced'], nextSteps: ['Review with the client']
    },
    missingInformation: ['How many orders a day?']
  }
};
b = await renderScopePdf(scope);
d = await PDFDocument.load(b);
check(d.getPageCount() >= 2 && /Scope of Project/.test(d.getTitle() || '') && /version 2/.test(d.getTitle() || ''), 'a scope PDF is real, several pages, titled with its version', d.getPageCount());
check(Buffer.compare(Buffer.from(b), Buffer.from(await renderScopePdf(scope))) === 0, 'the same scope gives the same bytes');
const sparse = await renderScopePdf({ ...scope, content: { projectScope: { overview: 'Only an overview' } } });
check((await PDFDocument.load(sparse)).getPageCount() === 1, 'a sparse scope prints only what exists (no empty headings invented)');
fs.writeFileSync(`${process.env.SAMPLE_DIR || '.'}/sample-scope.pdf`, b);
console.log(`=== ${passed} BUSINESS ASSOCIATE PDF CHECKS PASSED ===`);
