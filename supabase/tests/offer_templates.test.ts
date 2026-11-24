// Role-based Offer Letters (migration 20270206000100): the shared template logic (amounts, words, dates, field checks, the editor's markup) and the
// PDF renderer for each of the five supplied templates (its own letterhead and wording, every value filled in, the same bytes every time), and
// that the bundled letterheads keep nothing of the sample letters they were made from.
import { PDFArray, PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import {
  allowedPlaceholders, amountInWords, blocksToMarkup, checkOfferValues, indianGrouping, INITIAL_OFFER_TEMPLATES, markupToBlocks, offerLongDate,
  offerStartingValues, offerTemplateProblems, parseAmount, type OfferTemplateContent
} from '../../shared/offerTemplates.js';
import { offerTemplateContentSchema, offerTemplateFileUploadSchema, hrDocRequestSchema } from '../../shared/validation.js';
import { renderOfferTemplatePdf } from '../../server/hrDocuments/offerTemplate.js';
import { OFFER_LETTERHEADS } from '../../server/hrDocuments/offerLetterheads.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
async function textOf(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const doc = await PDFDocument.load(bytes);
  let text = '';
  for (const page of doc.getPages()) {
    const c = page.node.Contents();
    for (const ref of c instanceof PDFArray ? c.asArray() : [page.node.get(PDFName.of('Contents'))]) {
      const raw = Buffer.from(decodePDFRawStream(doc.context.lookup(ref) as never).decode()).toString('latin1');
      for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text += Buffer.from(m[1], 'hex').toString('latin1');
      for (const m of raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) text += m[1];
      for (const m of raw.matchAll(/\[((?:[^\]])*)\]\s*TJ/g)) text += Array.from(m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g), x => x[1]).join('');
    }
  }
  return { pages: doc.getPageCount(), text: text.replace(/\s+/g, '') };
}

// --- values
check(indianGrouping(18000) === '18,000' && indianGrouping(125000) === '1,25,000' && indianGrouping(999) === '999' && indianGrouping(10000000) === '1,00,00,000', 'Indian digit grouping');
check(amountInWords(18000) === 'Eighteen Thousand' && amountInWords(125500) === 'One Lakh Twenty Five Thousand Five Hundred' && amountInWords(10000000) === 'One Crore'
  && amountInWords(21) === 'Twenty One', 'amount in words (crore, lakh, thousand)');
check(parseAmount('18000') === 18000 && parseAmount('₹18,000') === 18000 && parseAmount('18,000/-') === 18000 && parseAmount('18000.50') === null && parseAmount('0') === null && parseAmount('abc') === null,
  'whole-rupee amounts');
check(offerLongDate('2026-08-20') === '20th August 2026' && offerLongDate('2026-08-01') === '1st August 2026' && offerLongDate('2026-08-12') === '12th August 2026'
  && offerLongDate('2026-08-23') === '23rd August 2026', 'dates as on the supplied letters ("20th August 2026")');

const tech = INITIAL_OFFER_TEMPLATES.find(t => t.key === 'technical-support')!;
const cs = INITIAL_OFFER_TEMPLATES.find(t => t.key === 'customer-support')!;
const bde = INITIAL_OFFER_TEMPLATES.find(t => t.key === 'business-development')!;
const start = (c: OfferTemplateContent) => offerStartingValues(c.fields, { employeeName: 'Priya Sharma', department: 'Sales', joiningDate: '2026-12-01', monthlySalary: '₹18,000/- per month (Fixed)', today: '2026-11-24' });
check(start(tech.content).salary === '18000' && start(tech.content).reportingTo === 'Team Leader' && start(tech.content).designation === 'Technical Support Executive'
  && start(tech.content).letterDate === '2026-11-24', 'starting values: the CRM record and the sample\'s own values');
check(start(cs.content).title === '', 'the title is never guessed (no starting value)');
const ok = checkOfferValues(cs.content.fields, { ...start(cs.content), title: 'Ms.' });
check(!Object.keys(ok.errors).length && ok.printed.salary === '18,000' && ok.printed.salaryWords === 'Eighteen Thousand' && ok.printed.joiningDate === '1st December 2026', 'printed values');
const bad = checkOfferValues(cs.content.fields, { ...start(cs.content), title: 'Dr.', salary: '18000.5', joiningDate: '2026-02-30', employeeName: '' });
check(!!bad.errors.title && !!bad.errors.salary && !!bad.errors.joiningDate && !!bad.errors.employeeName, 'a choice off the list, a part rupee, an impossible date and a missing name are refused', bad.errors);
check(!!checkOfferValues(tech.content.fields, { ...start(tech.content), department: 'Sales {x}' }).errors.department, 'a value cannot carry a placeholder or bold marks');

// --- templates
for (const t of INITIAL_OFFER_TEMPLATES) {
  check(offerTemplateProblems(t.content).length === 0 && offerTemplateContentSchema.safeParse(t.content).success, `${t.designation}: a valid template`);
  check(JSON.stringify(markupToBlocks(blocksToMarkup(t.content.blocks))) === JSON.stringify(t.content.blocks), `${t.designation}: the editor's text gives back the same wording`);
}
check(new Set(INITIAL_OFFER_TEMPLATES.map(t => JSON.stringify(t.content.blocks))).size === 5, 'five different wordings, one per designation');
check(allowedPlaceholders(cs.content.fields).has('salaryWords') && !allowedPlaceholders(tech.content.fields).has('refNo') && allowedPlaceholders(bde.content.fields).has('refNo'),
  'each template has its own fields');
check(offerTemplateProblems({ ...tech.content, blocks: [...tech.content.blocks, { type: 'paragraph', text: 'Bonus {bonus}' }] }).some(p => p.includes('{bonus}')), 'a placeholder that is not a field is refused');
check(offerTemplateProblems({ ...tech.content, fields: [...tech.content.fields, { key: 'salary', label: 'Again', type: 'text', required: false }] }).some(p => p.includes('once')), 'a field key is used once');
check(offerTemplateProblems({ ...tech.content, blocks: [{ type: 'paragraph', text: '**open' }] }).some(p => p.includes('bold')), 'an unclosed bold is refused');
check(!offerTemplateFileUploadSchema.safeParse({ kind: 'LETTERHEAD', fileName: 'x.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataBase64: 'UEsDBAAAAA==' }).success,
  'a letterhead upload must be a PDF');
check(hrDocRequestSchema.safeParse({ type: 'OFFER', employeeKey: 'HR:X', fields: { offerTemplateId: '11111111-1111-4111-8111-111111111111', templateVersion: 1, values: { employeeName: 'A' } } }).success
  && !hrDocRequestSchema.safeParse({ type: 'OFFER', employeeKey: 'HR:X', fields: { offerTemplateId: '11111111-1111-4111-8111-111111111111', templateVersion: 1, values: { employeeName: 'A' }, content: {} } }).success,
  'a role-based request carries only the template, the version and the values (never the wording)');

// --- the PDFs
const MARK: Record<string, string[]> = {
  'technical-support': ['OFFERLETTER', 'TechnicalSupportExecutive', 'smoothoperationalsupportforWabastore', 'MissAartiKalange', 'DearPriyaSharma,'],
  'customer-support': ['APPOINTMENTLETTER', 'Ms.PriyaSharma', '(RupeesEighteenThousandOnly)', 'ANNEXUREA', 'Mrs.AartiKalange'],
  'business-development': ['REF-NO:MPL/OFFER/2026/07', 'Date:24thNovember2026', 'M-PillarCorporation', 'ReshmaWadhavane(CEO)'],
  'sales-executive': ['SalesExecutive', 'TeamLeaderandDepartmentHead', 'Miss.AartiKalange(CEO)'],
  'ai-developer': ['AiDeveloperIntern', 'Department:AiStudio', 'Mr.AmolKamble']
};
for (const t of INITIAL_OFFER_TEMPLATES) {
  const raw = { ...start(t.content), ...(t.key === 'customer-support' ? { title: 'Ms.' } : {}), ...(t.key === 'business-development' ? { refNo: 'MPL/OFFER/2026/07' } : {}) };
  const { printed, errors } = checkOfferValues(t.content.fields, raw);
  check(!Object.keys(errors).length, `${t.designation}: the sample values are accepted`, errors);
  const lh = OFFER_LETTERHEADS[(t.letterhead as { builtin: string }).builtin];
  const input = { content: t.content, values: printed, letterhead: { bytes: Buffer.from(lh.base64, 'base64'), layout: lh.layout }, documentTitle: 'Offer Letter', letterDateIso: '2026-11-24' };
  const a = await renderOfferTemplatePdf(input);
  const b = await renderOfferTemplatePdf(input);
  check(Buffer.from(a).equals(Buffer.from(b)), `${t.designation}: the same values give the same bytes (the preview is the stored file)`);
  const { pages, text } = await textOf(a);
  const missing = MARK[t.key].filter(m => !text.includes(m));
  check(!missing.length && !text.includes('{') && !text.includes('**'), `${t.designation}: its own wording with every value filled in (${pages} pages)`, missing);
  check(t.key === 'customer-support' ? pages >= 4 : pages >= 1 && pages <= 3, `${t.designation}: page count`, pages);
}

// --- the letterheads: page 1 of each sample with the sample letter removed
const SAMPLE_WORDS = ['Dear', 'Subject', 'Responsibilities', 'Designation', 'Reporting', '18,000', '20th', '19th', 'REF-NO', 'APPOINTMENT', 'Acceptance'];
for (const [key, lh] of Object.entries(OFFER_LETTERHEADS)) {
  const doc = await PDFDocument.load(Buffer.from(lh.base64, 'base64'));
  const { text } = await textOf(Buffer.from(lh.base64, 'base64'));
  check(doc.getPageCount() === 1 && !SAMPLE_WORDS.some(w => text.includes(w)) && (doc.getAuthor() ?? '') === '', `letterhead ${key}: one page, nothing of the sample letter, no author`);
}
check(Object.keys(OFFER_LETTERHEADS).length === 5 && INITIAL_OFFER_TEMPLATES.every(t => 'builtin' in t.letterhead && OFFER_LETTERHEADS[t.letterhead.builtin]), 'each template has its own bundled letterhead');
console.log(`=== ${passed} OFFER TEMPLATE CHECKS PASSED ===`);
