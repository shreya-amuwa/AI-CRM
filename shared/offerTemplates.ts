/**
 * Role-based Offer Letter templates (HR > Offer Letter Generation; migration 20270205000100). One template per designation, each versioned, each
 * with its own letterhead, its own wording and its own fields. Shared by the form (browser) and the PDF renderer (server).
 *
 * The five initial templates are the samples HR supplied (Technical Support, Customer Support appointment letter, Business Development
 * Executive, Sales Executive, AI Developer): their wording is copied as written, and only the values that change from person to person (the
 * name, the dates, the salary, the department, the reference number ...) became fields. Nothing was added to them. The migration seeds exactly
 * these templates as version 1; the API test checks that.
 *
 *   {field}        replaced by the field's value (a date field is printed "20th August 2026", an amount "18,000")
 *   {fieldWords}   for an amount field: the amount in words ("Eighteen Thousand")
 *   **text**       printed in bold
 */

export type OfferFieldType = 'text' | 'textarea' | 'date' | 'money' | 'select';
/** Where a field's starting value comes from in the CRM (HR can still change it). */
export type OfferFieldSource = 'employeeName' | 'designation' | 'department' | 'joiningDate' | 'monthlySalary' | 'today';

export interface OfferTemplateField {
  /** the placeholder name: letters and digits, starting with a lower-case letter */
  key: string;
  label: string;
  type: OfferFieldType;
  required: boolean;
  /** the sample's own value ('' or absent when the sample leaves it blank) */
  default?: string;
  options?: string[];
  source?: OfferFieldSource;
  help?: string;
}

export type OfferBlock =
  | { type: 'title'; text: string }
  | { type: 'paragraph'; text: string; align?: 'center'; tight?: boolean }
  | { type: 'heading'; text: string; plain?: boolean }
  | { type: 'bullets'; items: string[] }
  | { type: 'signature'; label: string }
  | { type: 'pageBreak' };

export interface OfferTemplateContent {
  /** the line above the title: an optional left part (a reference number) and the date on the right */
  dateLine: { left?: string; right: string };
  blocks: OfferBlock[];
  fields: OfferTemplateField[];
}

/** A letterhead: one bundled with the CRM (from a supplied sample) or a PDF HR uploaded. */
export type OfferLetterhead = { builtin: string } | { fileId: string };

export const OFFER_FIELD_TYPES: OfferFieldType[] = ['text', 'textarea', 'date', 'money', 'select'];
export const OFFER_FIELD_SOURCES: OfferFieldSource[] = ['employeeName', 'designation', 'department', 'joiningDate', 'monthlySalary', 'today'];
export const OFFER_SOURCE_LABEL: Record<OfferFieldSource, string> = {
  employeeName: "the employee's name", designation: 'the designation on record', department: 'the department on record',
  joiningDate: 'the joining date on record', monthlySalary: 'the monthly salary on record', today: "today's date"
};
export const OFFER_TITLE_OPTIONS = ['Mr.', 'Ms.', 'Mrs.', 'Miss'];
export const OFFER_FIELD_KEY = /^[a-z][A-Za-z0-9]{1,30}$/;
export const OFFER_TEMPLATE_KEY = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const OFFER_MAX_PAGES = 10;
export const OFFER_MAX_AMOUNT = 99_99_99_999; // below 100 crore

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDate(iso: string): boolean {
  const m = ISO_DAY.exec(iso);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
/** "2026-08-20" -> "20th August 2026" (as on the supplied letters; the same as the other HR letters). */
export function offerLongDate(iso: string): string {
  const m = ISO_DAY.exec(iso);
  if (!m || !isRealDate(iso)) return iso;
  const day = Number(m[3]);
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** A whole-rupee amount as typed ("18000", "18,000", "₹18,000") -> 18000, or null. */
export function parseAmount(raw: string): number | null {
  const v = raw.trim().replace(/^₹\s*/, '').replace(/,/g, '').replace(/\/-$/, '');
  if (!/^\d{1,10}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= OFFER_MAX_AMOUNT ? n : null;
}
/** The amount at the start of a salary as the HR record may hold it ("₹18,000/- per month (Fixed)", "18000") -> 18000, or null. */
export function amountFromRecord(raw: string): number | null {
  const m = /^\s*(?:₹|Rs\.?|INR)?\s*([\d,]+)(?:\.0+)?\s*(?:\/-)?/i.exec(raw);
  return m ? parseAmount(m[1]) : null;
}
/** 1850000 -> "18,50,000" (Indian grouping). */
export function indianGrouping(n: number): string {
  const s = String(Math.trunc(n));
  if (s.length <= 3) return s;
  const last = s.slice(-3);
  return `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last}`;
}
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', below100(n % 100)].filter(Boolean).join(' ');
/** 18000 -> "Eighteen Thousand"; 125000 -> "One Lakh Twenty Five Thousand" (the Indian system: crore, lakh, thousand). */
export function amountInWords(n: number): string {
  if (!Number.isFinite(n) || n < 1) return '';
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  return [crore ? `${below100(crore)} Crore` : '', lakh ? `${below100(lakh)} Lakh` : '', thousand ? `${below100(thousand)} Thousand` : '', rest ? below1000(rest) : '']
    .filter(Boolean).join(' ');
}

/** The placeholders a template may use: each field, and the words of each amount. */
export function allowedPlaceholders(fields: OfferTemplateField[]): Set<string> {
  const out = new Set<string>();
  for (const f of fields) { out.add(f.key); if (f.type === 'money') out.add(`${f.key}Words`); }
  return out;
}

/** Checks the values HR entered against the template's fields. Returns { values (printed form), errors (by field key) }. */
export function checkOfferValues(fields: OfferTemplateField[], raw: Record<string, string>): { printed: Record<string, string>; errors: Record<string, string> } {
  const printed: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (raw[f.key] ?? '').trim();
    if (!v) {
      if (f.required) errors[f.key] = `Enter the ${f.label.toLowerCase()}.`;
      printed[f.key] = '';
      if (f.type === 'money') printed[`${f.key}Words`] = '';
      continue;
    }
    const max = f.type === 'textarea' ? 2000 : 200;
    if (v.length > max) { errors[f.key] = `Keep the ${f.label.toLowerCase()} under ${max} characters.`; continue; }
    if (f.type === 'date') {
      if (!isRealDate(v)) { errors[f.key] = `Enter a real date for the ${f.label.toLowerCase()}.`; continue; }
      printed[f.key] = offerLongDate(v);
    } else if (f.type === 'money') {
      const n = parseAmount(v);
      if (n === null) { errors[f.key] = `Enter the ${f.label.toLowerCase()} in whole rupees (for example 18000).`; continue; }
      printed[f.key] = indianGrouping(n);
      printed[`${f.key}Words`] = amountInWords(n);
    } else if (f.type === 'select') {
      if (!(f.options ?? []).includes(v)) { errors[f.key] = `Choose the ${f.label.toLowerCase()} from the list.`; continue; }
      printed[f.key] = v;
    } else {
      if (/[{}*]/.test(v)) { errors[f.key] = `The ${f.label.toLowerCase()} cannot contain { } or *.`; continue; }
      printed[f.key] = v.replace(/\s+/g, ' ');
    }
  }
  return { printed, errors };
}

export function fillOfferText(text: string, values: Record<string, string>): string {
  return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (all, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : all));
}

// ---------------------------------------------------------------------------
// Checking a template
// ---------------------------------------------------------------------------
export function offerTemplateTexts(c: OfferTemplateContent): string[] {
  const out = [c.dateLine.left ?? '', c.dateLine.right];
  for (const b of c.blocks) {
    if (b.type === 'bullets') out.push(...b.items);
    else if (b.type === 'signature') out.push(b.label);
    else if (b.type !== 'pageBreak') out.push(b.text);
  }
  return out;
}

/** What is wrong with a template (an empty list when it can be saved). */
export function offerTemplateProblems(c: OfferTemplateContent): string[] {
  const problems: string[] = [];
  const keys = c.fields.map(f => f.key);
  if (!c.blocks.some(b => b.type !== 'pageBreak')) problems.push('The letter has no wording.');
  if (!c.fields.length) problems.push('Add at least one field.');
  for (const f of c.fields) {
    if (!OFFER_FIELD_KEY.test(f.key)) problems.push(`The field key "${f.key}" must be letters and digits starting with a small letter (for example joiningDate).`);
    if (!f.label.trim()) problems.push(`The field "${f.key}" needs a label.`);
    if (f.type === 'select' && !(f.options ?? []).filter(o => o.trim()).length) problems.push(`The list "${f.label}" needs its choices.`);
    if (f.default && f.type === 'select' && !(f.options ?? []).includes(f.default)) problems.push(`The starting value of "${f.label}" is not one of its choices.`);
  }
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dup.length) problems.push(`Each field key is used once (${Array.from(new Set(dup)).join(', ')}).`);
  const allowed = allowedPlaceholders(c.fields);
  const unknown = Array.from(new Set(offerTemplateTexts(c).flatMap(t => Array.from(t.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g), m => m[1])).filter(p => !allowed.has(p))));
  if (unknown.length) problems.push(`The wording uses {${unknown.join('}, {')}}, which ${unknown.length === 1 ? 'is not a field' : 'are not fields'}. Add the field or correct the name.`);
  for (const t of offerTemplateTexts(c)) {
    if ((t.match(/\*\*/g)?.length ?? 0) % 2) { problems.push(`A ** (bold) is not closed in: "${t.slice(0, 60)}"`); break; }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The wording as text (the template editor): one line per paragraph, a blank line before a new section
// ---------------------------------------------------------------------------
/**
 *   = TEXT          a title (bold, centred)
 *   # Text          a heading (bold)        ## Text  a heading in normal weight
 *   - text          a bullet point (consecutive bullets form one list)
 *   ^ text          a centred paragraph
 *   [signature] Signature:-      a label with a line to sign on
 *   [page]          start a new page
 *   any other line  a paragraph; a line right under another one (no blank line between) continues the section with no extra space
 */
export const OFFER_MARKUP_HELP = [
  ['= TEXT', 'a title (bold, centred)'],
  ['# Text', 'a heading (bold); ## Text for a heading in normal weight'],
  ['- text', 'a bullet point'],
  ['^ text', 'a centred line'],
  ['[signature] Signature:-', 'a label with a line to sign on'],
  ['[page]', 'start a new page'],
  ['**text**', 'bold'],
  ['{field}', "the field's value; {amountWords} the amount in words"]
] as const;

export function blocksToMarkup(blocks: OfferBlock[]): string {
  const out: string[] = [];
  let prev: OfferBlock | null = null;
  for (const b of blocks) {
    const blank = prev !== null && !(b.type === 'paragraph' && b.tight) && !(b.type === 'bullets' && prev.type === 'heading');
    if (blank) out.push('');
    if (b.type === 'title') out.push(`= ${b.text}`);
    else if (b.type === 'heading') out.push(`${b.plain ? '##' : '#'} ${b.text}`);
    else if (b.type === 'bullets') out.push(...b.items.map(i => `- ${i}`));
    else if (b.type === 'signature') out.push(`[signature] ${b.label}`);
    else if (b.type === 'pageBreak') out.push('[page]');
    else out.push(`${b.align === 'center' ? '^ ' : ''}${b.text}`);
    prev = b;
  }
  return out.join('\n');
}

export function markupToBlocks(markup: string): OfferBlock[] {
  const blocks: OfferBlock[] = [];
  let afterBlank = true;
  for (const raw of markup.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { afterBlank = true; continue; }
    const t = line.trim();
    const last = blocks[blocks.length - 1];
    if (t.startsWith('- ') || t === '-') {
      const item = t.slice(1).trim();
      if (last?.type === 'bullets' && !afterBlank) last.items.push(item);
      else blocks.push({ type: 'bullets', items: [item] });
    } else if (t.startsWith('## ')) blocks.push({ type: 'heading', text: t.slice(3).trim(), plain: true });
    else if (t.startsWith('# ')) blocks.push({ type: 'heading', text: t.slice(2).trim() });
    else if (t.startsWith('= ')) blocks.push({ type: 'title', text: t.slice(2).trim() });
    else if (/^\[page\]$/i.test(t)) blocks.push({ type: 'pageBreak' });
    else if (/^\[signature\]/i.test(t)) blocks.push({ type: 'signature', label: t.replace(/^\[signature\]\s*/i, '') });
    else if (t.startsWith('^ ')) blocks.push({ type: 'paragraph', text: t.slice(2).trim(), align: 'center', ...(afterBlank || !last ? {} : { tight: true }) });
    else blocks.push({ type: 'paragraph', text: t, ...(afterBlank || !last ? {} : { tight: true }) });
    afterBlank = false;
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// The five supplied samples (version 1)
// ---------------------------------------------------------------------------
const f = {
  letterDate: (): OfferTemplateField => ({ key: 'letterDate', label: 'Offer date', type: 'date', required: true, source: 'today' }),
  name: (): OfferTemplateField => ({ key: 'employeeName', label: 'Employee name', type: 'text', required: true, source: 'employeeName' }),
  designation: (d: string): OfferTemplateField => ({ key: 'designation', label: 'Designation', type: 'text', required: true, default: d }),
  department: (d?: string): OfferTemplateField => (d ? { key: 'department', label: 'Department', type: 'text', required: true, default: d }
    : { key: 'department', label: 'Department', type: 'text', required: true, source: 'department' }),
  joining: (): OfferTemplateField => ({ key: 'joiningDate', label: 'Date of joining', type: 'date', required: true, source: 'joiningDate' }),
  salary: (): OfferTemplateField => ({ key: 'salary', label: 'Salary per month (₹)', type: 'money', required: true, source: 'monthlySalary', help: 'Whole rupees, for example 18000.' }),
  employmentType: (): OfferTemplateField => ({ key: 'employmentType', label: 'Employment type', type: 'text', required: true, default: 'Full-Time' }),
  workingHours: (): OfferTemplateField => ({ key: 'workingHours', label: 'Working hours', type: 'text', required: true, default: 'As per company policy' }),
  probation: (): OfferTemplateField => ({ key: 'probation', label: 'Probation period', type: 'text', required: true, default: '6 Months' }),
  reportingTo: (d: string): OfferTemplateField => ({ key: 'reportingTo', label: 'Reporting to', type: 'text', required: true, default: d }),
  signatory: (d: string): OfferTemplateField => ({ key: 'signatoryName', label: 'Signatory', type: 'text', required: true, default: d })
};

/** The offer letters with one page of terms (Technical Support, Business Development Executive, Sales Executive, AI Developer) share this shape. */
const offerBlocks = (o: {
  salutation: string; intro: string[]; responsibilities: string[]; terms: string[]; company: string; signatoryLine: string; acceptance: string;
}): OfferBlock[] => [
  { type: 'title', text: 'OFFER LETTER' },
  { type: 'paragraph', text: '**Subject:** Offer Letter for the Position of **{designation}**', align: 'center' },
  { type: 'paragraph', text: o.salutation },
  ...o.intro.map((text, i): OfferBlock => ({ type: 'paragraph', text, ...(i ? { tight: true } : {}) })),
  { type: 'heading', text: 'Key Responsibilities' },
  { type: 'bullets', items: o.responsibilities },
  { type: 'heading', text: 'Employment Terms' },
  { type: 'bullets', items: o.terms },
  { type: 'paragraph', text: 'This offer is subject to your acceptance and adherence to company policies, rules, and regulations.' },
  { type: 'paragraph', text: `We look forward to your contribution and a successful association with ${o.company}.`, tight: true },
  { type: 'paragraph', text: `**For ${o.company},**` },
  { type: 'paragraph', text: o.signatoryLine },
  { type: 'signature', label: '**Signature:-**' },
  { type: 'heading', text: 'Acceptance' },
  { type: 'paragraph', text: o.acceptance, tight: true },
  { type: 'signature', label: '**Signature:**' },
  { type: 'signature', label: '**Date:**' }
];

const STANDARD_TERMS = (joiningLabel = 'Date of Joining:') => [
  'Designation: {designation}', 'Department: {department}', 'Employment Type: {employmentType}', `${joiningLabel} {joiningDate}`,
  'Salary: ₹{salary}/- per month (Fixed)', 'Working Hours: {workingHours}', 'Probation Period: {probation}', 'Reporting To: {reportingTo}'
];

export interface InitialOfferTemplate { key: string; designation: string; description: string; sortOrder: number; letterhead: OfferLetterhead; content: OfferTemplateContent }

export const INITIAL_OFFER_TEMPLATES: InitialOfferTemplate[] = [
  {
    key: 'technical-support', designation: 'Technical Support', sortOrder: 1, letterhead: { builtin: 'technical-support' },
    description: 'Offer Letter – Technical Support Executive (Amuwa Corporation).',
    content: {
      dateLine: { right: 'Date: {letterDate}' },
      fields: [f.letterDate(), f.name(), f.designation('Technical Support Executive'), f.department(), f.joining(), f.salary(), f.employmentType(),
        f.workingHours(), f.probation(), f.reportingTo('Team Leader'), f.signatory('Miss Aarti Kalange')],
      blocks: offerBlocks({
        salutation: '**Dear {employeeName},**',
        intro: [
          'With reference to your application and our discussions, we are pleased to offer you the position of **{designation}** in the {department} Department at Amuwa Corporation, effective from {joiningDate}.',
          'In this role, you will be responsible for providing technical assistance, resolving system-related issues, and ensuring smooth operational support for Wabastore.'
        ],
        responsibilities: [
          'Providing technical support for systems, tools, and platforms used by the team',
          'Resolving technical issues related to orders, dashboards, and internal processes',
          'Assisting in troubleshooting customer-related technical concerns',
          'Coordinating with internal teams for issue resolution',
          'Maintaining system records and technical documentation',
          'Ensuring smooth functioning of day-to-day technical operations',
          'Supporting team members with basic technical guidance'
        ],
        terms: STANDARD_TERMS(),
        company: 'Amuwa Corporation',
        signatoryLine: '**Name:- {signatoryName}**',
        acceptance: 'I, **{employeeName}**, hereby accept the offer for the position of {designation} at Amuwa Corporation and agree to abide by all the terms and conditions mentioned above.'
      })
    }
  },
  {
    key: 'customer-support', designation: 'Customer Support', sortOrder: 2, letterhead: { builtin: 'customer-support' },
    description: 'Appointment Letter – Customer Support Executive, with Annexure A – Company Policies (Amuwa Corporation).',
    content: {
      dateLine: { right: 'Date: {letterDate}' },
      fields: [
        f.letterDate(),
        { key: 'title', label: 'Title', type: 'select', required: true, options: OFFER_TITLE_OPTIONS, help: 'Printed before the name (the sample letter has "Ms."). Never guessed from the name.' },
        f.name(), f.designation('Customer Support Executive'), f.joining(), f.salary(),
        f.signatory('Miss.Aarti Kalange'),
        { key: 'annexureSignatoryName', label: 'Signatory (Annexure A)', type: 'text', required: true, default: 'Mrs.Aarti Kalange' }
      ],
      blocks: [
        { type: 'title', text: 'APPOINTMENT LETTER' },
        { type: 'paragraph', text: 'We are pleased to appoint {title} {employeeName} as {designation} with Amuwa Corporation, effective from {joiningDate}, on the following terms and conditions:' },
        { type: 'heading', text: '1. Designation', plain: true },
        { type: 'paragraph', text: 'You are appointed as {designation}. Your duties will include customer communication, query handling, client follow-ups, complaint resolution, service coordination, and any other tasks assigned related to your role.', tight: true },
        { type: 'heading', text: '2. Date of Joining', plain: true },
        { type: 'paragraph', text: 'Your Date of Joining (DOJ) shall be {joiningDate}', tight: true },
        { type: 'heading', text: '3. Salary', plain: true },
        { type: 'paragraph', text: 'You will be paid a consolidated salary of ₹{salary}/- (Rupees {salaryWords} Only) per month.', tight: true },
        { type: 'heading', text: '4. Roles & Responsibilities:', plain: true },
        { type: 'bullets', items: [
          'Handle customer inquiries through calls, messages, email, and other channels',
          'Resolve customer queries professionally and in a timely manner',
          'Maintain customer records and follow-up updates',
          'Coordinate with internal teams for smooth service delivery',
          'Handle complaints politely and ensure customer satisfaction',
          'Assist clients with product/service information and support',
          'Maintain daily reports of customer interactions and feedback',
          'Ensure professional communication standards at all times'
        ] },
        { type: 'heading', text: '5. Probation Period', plain: true },
        { type: 'bullets', items: [
          'You will be on probation for a period of six (6) months from your date of joining.',
          'Your confirmation after probation shall depend upon satisfactory performance, discipline, attendance, and management approval. (Refer- Annexure A )'
        ] },
        { type: 'heading', text: '6. Working Hours & Attendance', plain: true },
        { type: 'bullets', items: ['You shall follow the official office timings and maintain punctuality.Attendance, late marks, half-day deductions, and discipline rules shall be applicable as per Company Policy(Refer-Annexure A )'] },
        { type: 'heading', text: '7. Leave Policy', plain: true },
        { type: 'bullets', items: ['Your leave entitlement, paid leave rules, leave without pay, sandwich leave, encashment, and approval process shall be governed strictly as per Company Policy'] },
        { type: 'paragraph', text: '(Refer- Annexure A )', tight: true },
        { type: 'heading', text: '8. Increment / Incentive', plain: true },
        { type: 'bullets', items: ['Any salary increment, bonus, incentive, or performance reward shall be entirely based on management discretion and performance review. (Refer- Annexure A )'] },
        { type: 'heading', text: '9. Confidentiality', plain: true },
        { type: 'bullets', items: [
          'You shall maintain complete confidentiality regarding client data, passwords, pricing, creative files, leads, internal processes, and business information.',
          'Any breach shall invite disciplinary/legal action. (Refer- Annexure A )'
        ] },
        { type: 'heading', text: '10. Company Assets', plain: true },
        { type: 'bullets', items: ['Any company equipment, software login, mobile, laptop, camera, accessories, or tools issued to you must be handled responsibly and returned upon separation.'] },
        { type: 'heading', text: '11. Transfer / Additional Duties', plain: true },
        { type: 'bullets', items: ['The company reserves the right to assign additional responsibilities or modify job duties based on business requirements.'] },
        { type: 'heading', text: '12. Termination / Separation', plain: true },
        { type: 'bullets', items: ['Your employment may be terminated by either side by serving notice period as applicable', '(Refer- Annexure A )'] },
        { type: 'paragraph', text: 'Full & Final Settlement shall be subject to handover of work, assets, passwords, and pending dues.', tight: true },
        { type: 'heading', text: '13. Acceptance', plain: true },
        { type: 'bullets', items: ['Please sign and return a copy of this letter as a token of your acceptance of the above terms.'] },
        { type: 'paragraph', text: 'We welcome you to Amuwa Corporation and wish you a successful career with us.' },
        { type: 'paragraph', text: 'Regards,' },
        { type: 'paragraph', text: 'Amuwa Corporation', tight: true },
        { type: 'paragraph', text: '{signatoryName}', tight: true },
        { type: 'signature', label: 'Signature:' },
        { type: 'paragraph', text: 'Employee Acceptance' },
        { type: 'paragraph', text: 'I, {title} {employeeName} accept the above appointment terms and agree to follow company rules.', tight: true },
        { type: 'signature', label: 'Employee Signature:' },
        { type: 'signature', label: 'Name:' },
        { type: 'signature', label: 'Date:' },
        { type: 'pageBreak' },
        { type: 'paragraph', text: 'ANNEXURE A – Company Policies (Part of Appointment Letter)', align: 'center' },
        { type: 'heading', text: '1. Leave Policy', plain: true },
        { type: 'paragraph', text: 'Purpose This policy outlines the leave structure applicable to employees of the company and ensures consistency, transparency, and fairness in leave management.', tight: true },
        { type: 'heading', text: 'Probation Period', plain: true },
        { type: 'bullets', items: [
          'All newly hired employees will be on probation for six (6) months from their date of joining.',
          'During this period, employees’ performance, attendance, discipline, and suitability for permanent employment will be evaluated.',
          'If total leaves / absenteeism during probation is 15 days or more, probation will be extended by one (1) month.'
        ] },
        { type: 'heading', text: 'Leave During Probation', plain: true },
        { type: 'bullets', items: ['No paid leave during probation.', 'Any leave availed will be treated as Leave Without Pay (LWP).', 'Excessive absenteeism may impact confirmation.'] },
        { type: 'heading', text: 'Confirmation', plain: true },
        { type: 'bullets', items: ['Upon successful completion of probation, employees may be confirmed subject to satisfactory performance and management approval.'] },
        { type: 'heading', text: 'Leave After Confirmation', plain: true },
        { type: 'bullets', items: [
          'Confirmed employees are entitled to two (2) paid leaves per month.',
          'Paid leave is credited monthly.',
          'If absenteeism in a particular month is more than 10 days, only one (1) paid leave will be credited for that month.'
        ] },
        { type: 'heading', text: 'Carry Forward Rule', plain: true },
        { type: 'bullets', items: ['No leaves will be carried forward to the next calendar year.', 'Any leave balance more than 50% of total yearly entitled leaves will automatically lapse.'] },
        { type: 'heading', text: 'Leave Encashment', plain: true },
        { type: 'bullets', items: [
          'Up to 50% of total yearly entitled paid leaves may be eligible for encashment.',
          'Encashment shall be processed annually or during Full & Final Settlement, subject to management approval.'
        ] },
        { type: 'heading', text: 'Sandwich Leave Policy', plain: true },
        { type: 'bullets', items: [
          'If an employee remains absent immediately before and after weekly off / public holiday without approval, intervening holiday(s) may be counted as leave.',
          'Applicability shall be subject to management review.'
        ] },
        { type: 'heading', text: 'Leave Approval Process', plain: true },
        { type: 'bullets', items: ['Planned leaves must be applied in advance and approved by reporting manager.', 'Leave requests are subject to work requirements.'] },
        { type: 'heading', text: 'Emergency Leave', plain: true },
        { type: 'bullets', items: ['Employees must inform the reporting manager at the earliest possible time. Such requests will be reviewed case-by-case.'] },
        { type: 'heading', text: 'General Conditions', plain: true },
        { type: 'bullets', items: [
          'Unauthorized absence may lead to disciplinary action.',
          'Habitual absenteeism may affect increment, incentives, confirmation, or continuation.',
          'Company reserves the right to amend this policy.'
        ] },
        { type: 'heading', text: '2. Increment Policy', plain: true },
        { type: 'bullets', items: [
          'Salary increments are performance-based and not automatic.',
          'The increment will take place annually .',
          'Performance, discipline, attendance, quality of work, and contribution will be considered.',
          'Employees with poor attendance or warnings may not be eligible.'
        ] },
        { type: 'heading', text: '3. Bonus / Incentive Policy', plain: true },
        { type: 'bullets', items: [
          'Incentives / bonuses may be monthly, quarterly, yearly, or project-based.',
          'Incentives depend on targets, punctuality, productivity, revenue generation, and client satisfaction.',
          'Incentives are not part of fixed salary.',
          'Final decision remains with management.'
        ] },
        { type: 'heading', text: '4. Code of Conduct Policy', plain: true },
        { type: 'bullets', items: ['Maintain professionalism, discipline, punctuality, and respectful behavior.', 'Misconduct or misuse of company reputation/data may invite action.'] },
        { type: 'heading', text: '5. Attendance & Working Hours Policy', plain: true },
        { type: 'bullets', items: [
          'Employees must follow official office timings.',
          'Repeated late coming or attendance issues may lead to deductions or disciplinary action.',
          'Late marks beyond three (3) in a month will lead to one half-day present / deduction as per payroll policy.',
          'Attendance must be maintained through approved system/register.'
        ] },
        { type: 'heading', text: '6. Confidentiality Policy', plain: true },
        { type: 'bullets', items: [
          'Company data, passwords, client information, pricing, creatives, leads, and internal systems are confidential.',
          'Unauthorized sharing may lead to termination and legal action.'
        ] },
        { type: 'heading', text: '7. Asset / Equipment Policy', plain: true },
        { type: 'bullets', items: [
          'Company-issued laptop, mobile, camera, accessories, SIM, software login, or other assets must be used responsibly.',
          'Damage due to negligence may be recovered from employee.'
        ] },
        { type: 'heading', text: '8. Separation / Notice Period Policy', plain: true },
        { type: 'bullets', items: [
          'Employees must serve notice period as mentioned Below.',
          'During Probition Period -5 Day’s',
          'After Confirmation- 2 Months',
          'Pending dues, assets handover, and work handover are mandatory before Full & Final Settlement.'
        ] },
        { type: 'paragraph', text: '**Declaration**' },
        { type: 'paragraph', text: 'I have read, understood, and agreed to abide by the above Annexure A policies.', tight: true },
        { type: 'signature', label: 'Employee Signature:' },
        { type: 'signature', label: 'Name:' },
        { type: 'signature', label: 'Date:' },
        { type: 'paragraph', text: 'For Amuwa Corporation' },
        { type: 'paragraph', text: '{annexureSignatoryName}', tight: true },
        { type: 'signature', label: 'Signature:' }
      ]
    }
  },
  {
    key: 'business-development', designation: 'Business Development Executive', sortOrder: 3, letterhead: { builtin: 'business-development' },
    description: 'Offer Letter – Business Development Executive (BDE), on the M Pillar Corporation letterhead.',
    content: {
      dateLine: { left: 'REF-NO:{refNo}', right: 'Date: {letterDate}' },
      fields: [
        { key: 'refNo', label: 'Reference number', type: 'text', required: true, help: 'Printed after "REF-NO:", for example MPL/OFFER/2026/07.' },
        f.letterDate(), f.name(), f.designation('Business Development Executive'), f.department(), f.joining(), f.salary(), f.employmentType(),
        f.workingHours(), f.probation(), f.reportingTo('Team Leader'), f.signatory('Reshma Wadhavane (CEO)')
      ],
      blocks: offerBlocks({
        salutation: 'Dear **{employeeName}**,',
        intro: [
          'With reference to your application and our discussions, we are pleased to offer you the position of {designation} (BDE) in the at M Pillar Corporation, effective from {joiningDate}.',
          'In this role, you will be responsible for driving business growth, generating leads, and contributing to the overall sales performance Of M pillar Corporation.'
        ],
        responsibilities: [
          'Identifying and generating new business opportunities',
          'Handling customer inquiries and converting leads into sales',
          'Maintaining relationships with existing and potential clients',
          'Coordinating with the marketing and support team',
          'Achieving monthly sales targets and revenue goals',
          'Assisting in planning and executing sales strategies',
          'Maintaining proper records of leads and conversions'
        ],
        terms: ['Designation: {designation} (BDE)', ...STANDARD_TERMS().slice(1)],
        company: 'M-Pillar Corporation',
        signatoryLine: '**Name:- {signatoryName}**',
        acceptance: 'I, **{employeeName}**, hereby accept the offer for the position of {designation} at M-Pillar Corporation and agree to abide by all the terms and conditions mentioned above.'
      })
    }
  },
  {
    key: 'sales-executive', designation: 'Sales Executive', sortOrder: 4, letterhead: { builtin: 'sales-executive' },
    description: 'Offer Letter – Sales Executive (Amuwa Corporation, Wabastore).',
    content: {
      dateLine: { right: 'Date: {letterDate}' },
      fields: [f.letterDate(), f.name(), f.designation('Sales Executive'), f.department(), f.joining(), f.salary(), f.employmentType(),
        f.workingHours(), f.probation(), f.reportingTo('Team Leader and Department Head'), f.signatory('Miss. Aarti Kalange (CEO)')],
      blocks: offerBlocks({
        salutation: 'Dear **{employeeName}**,',
        intro: [
          'With reference to your application and our discussions, we are pleased to offer you the position of **{designation}** at Amuwa Corporation, effective from {joiningDate}.',
          'In this role, you will be responsible for generating sales, building strong customer relationships, and representing the company in the assigned territory.'
        ],
        responsibilities: [
          'Visit existing and potential customers within the assigned territory on a daily basis.',
          'Generate new business opportunities through field visits, referrals, and lead generation activities.',
          "Promote and explain the company's products and services to prospective customers.",
          'Conduct product demonstrations and presentations when required.',
          'Meet daily, weekly, and monthly sales targets assigned by the management.',
          'Develop and maintain strong relationships with customers to ensure repeat business.',
          'Follow up with leads and convert inquiries into successful sales..',
          'Travel within the assigned territory as required for business development and client meetings.',
          'Comply with all company policies, procedures, and safety guidelines.'
        ],
        terms: STANDARD_TERMS(),
        company: 'Amuwa Corporation',
        signatoryLine: '**Name:- {signatoryName}**',
        acceptance: 'I **{employeeName}**, hereby accept the offer for the position of {designation} at Amuwa Corporation and agree to abide by all the terms and conditions mentioned above.'
      })
    }
  },
  {
    key: 'ai-developer', designation: 'AI Developer', sortOrder: 5, letterhead: { builtin: 'ai-developer' },
    description: 'Offer Letter – Ai Developer Intern (Amuwa Corporation, AI Studio).',
    content: {
      dateLine: { right: 'Date: {letterDate}' },
      fields: [f.letterDate(), f.name(), f.designation('Ai Developer Intern'), f.department('Ai Studio'), f.joining(), f.salary(), f.employmentType(),
        f.workingHours(), f.probation(), f.reportingTo('Team Leader'), f.signatory('Mr. Amol Kamble')],
      blocks: offerBlocks({
        salutation: 'Dear {employeeName},',
        intro: [
          'With reference to your application and our discussions, we are pleased to offer you the position of **{designation}** at Amuwa Corporation, effective from {joiningDate}.',
          'In this role, you will support the AI development team in building, testing, improving, and implementing AI-based solutions and applications while gaining practical experience in AI and software development.'
        ],
        responsibilities: [
          'Assisting in building, training, and fine-tuning machine learning and AI models.',
          'Integrating AI/LLM solutions into company products and platforms.',
          'Writing clean, maintainable, and efficient code for software modules.',
          'Collaborating with engineering and product teams to design technical workflows.',
          'Testing, debugging, and optimizing existing algorithm performance.',
          'Maintaining technical documentation and reporting weekly progress.'
        ],
        terms: STANDARD_TERMS('Date of Joining :'),
        company: 'Amuwa Corporation',
        signatoryLine: '**Name:- {signatoryName}**',
        acceptance: 'I, **{employeeName},** hereby accept the offer for the position of {designation} at Amuwa Corporation and agree to abide by all the terms and conditions mentioned above.'
      })
    }
  }
];

/** The starting values of a form: the sample's defaults, then what the CRM knows (HR can change any of them). */
export function offerStartingValues(
  fields: OfferTemplateField[],
  record: { employeeName?: string | null; designation?: string | null; department?: string | null; joiningDate?: string | null; monthlySalary?: string | null; today: string }
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fd of fields) {
    const fromRecord = fd.source ? record[fd.source] : null;
    const salary = fd.source === 'monthlySalary' && fromRecord ? amountFromRecord(fromRecord) : null;
    out[fd.key] = fd.source === 'monthlySalary' ? (salary !== null ? String(salary) : fd.default ?? '') : (fromRecord ?? fd.default ?? '');
  }
  return out;
}
