import type { LeadUploadRawRow } from './contracts.js';
import { cleanIndianMobile } from './contactValidation.js';
import { leadUploadLeadSchema, type LeadUploadLeadInput } from './validation.js';

/**
 * Upload Leads (docs/LEAD_UPLOAD.md): the columns of the template, how a heading in a file is matched to a lead field, and how one row
 * becomes the values of the Add Lead form. Used by the browser (the preview) and by the API (which checks every row again).
 */
export type LeadUploadField = Exclude<keyof LeadUploadRawRow, 'row'>;

export const LEAD_UPLOAD_COLUMNS: { key: LeadUploadField; label: string; required: boolean; example: string; hint: string }[] = [
  { key: 'name', label: 'Customer Name', required: true, example: 'Customer_Name', hint: 'Required' },
  { key: 'contactPerson', label: 'Contact Person', required: false, example: 'Contact_Person_Name', hint: 'Saved in the lead notes' },
  { key: 'phone', label: 'Mobile Number', required: true, example: '9000000000', hint: 'Required. 10 digits, +91 allowed' },
  { key: 'email', label: 'Email Address', required: false, example: 'name@example.com', hint: '' },
  { key: 'company', label: 'Company Name', required: true, example: 'Company_Name', hint: 'Required (business name)' },
  { key: 'businessType', label: 'Business Type', required: false, example: 'Business_Type', hint: '' },
  { key: 'location', label: 'Location', required: false, example: 'City_Name', hint: 'City' },
  { key: 'services', label: 'Interested Service', required: true, example: 'WhatsApp API', hint: 'Required. Several: separate with ;' },
  { key: 'leadSource', label: 'Lead Source', required: false, example: 'Referral', hint: 'Empty = Other' },
  { key: 'description', label: 'Lead Description', required: false, example: 'Lead_Description', hint: '' },
  { key: 'followUpDate', label: 'Follow-up Date', required: false, example: '25-12-2026', hint: 'DD-MM-YYYY or YYYY-MM-DD' },
  { key: 'assignee', label: 'Assigned Employee', required: false, example: '', hint: 'E-mail of the employee; empty = you' }
];

/** The example row of earlier templates (real-sounding names). Old downloads still hold it, so it is still recognised as an example and skipped. */
export const LEAD_UPLOAD_LEGACY_EXAMPLE = ['Ravi Kumar', 'Ravi Kumar', '9876543210', 'ravi@example.com', 'Ravi Jewellers', 'Jewellery / Gold', 'Surat', 'WhatsApp API', 'Referral', 'Wants a demo next week', '25-12-2026', ''];

const ALIASES: Record<LeadUploadField, string[]> = {
  name: ['customer name', 'name', 'client name', 'lead name', 'customer', 'full name'],
  contactPerson: ['contact person', 'contact name', 'person name', 'contact'],
  phone: ['mobile number', 'mobile', 'mobile no', 'phone', 'phone number', 'phone no', 'contact number', 'contact no', 'whatsapp number', 'cell'],
  email: ['email address', 'email', 'e-mail', 'email id', 'mail'],
  company: ['company name', 'company', 'business name', 'business', 'company / business name', 'organisation', 'organization', 'firm', 'shop name'],
  businessType: ['business type', 'business category', 'category', 'industry', 'type of business'],
  location: ['location', 'city', 'town', 'place', 'area'],
  services: ['interested service', 'interested services', 'service', 'services', 'product', 'requirement'],
  leadSource: ['lead source', 'source'],
  description: ['lead description', 'description', 'notes', 'note', 'remarks', 'remark', 'comments', 'comment'],
  followUpDate: ['follow-up date', 'follow up date', 'followup date', 'follow-up', 'follow up', 'next follow-up', 'next follow up'],
  assignee: ['assigned employee', 'assigned to', 'assignee', 'owner', 'lead owner', 'employee', 'employee email']
};

export const normalizeHeading = (v: unknown) => String(v ?? '').toLowerCase().replace(/[*:]/g, '').replace(/[\s_./]+/g, ' ').replace(/\s*-\s*/g, '-').trim();

/** Column index of each lead field in a heading row (a column is used once; the first matching column wins). */
export function matchLeadUploadHeadings(headings: string[]): Partial<Record<LeadUploadField, number>> {
  const out: Partial<Record<LeadUploadField, number>> = {};
  const taken = new Set<number>();
  const norm = headings.map(normalizeHeading);
  for (const col of LEAD_UPLOAD_COLUMNS) {
    const wanted = ALIASES[col.key].map(normalizeHeading);
    const at = norm.findIndex((h, i) => !taken.has(i) && h !== '' && wanted.includes(h));
    if (at >= 0) {
      out[col.key] = at;
      taken.add(at);
    }
  }
  return out;
}

/** The lead sources of the Add Lead form (src/components/team-member/pipeline/shared.tsx LEAD_SOURCES): a typed source is written the same way. */
const KNOWN_SOURCES = ['Walk-in', 'Instagram', 'Meta Ads', 'Website', 'Referral', 'Cold call', 'WhatsApp', 'Google', 'Field visit', 'Other'];

const pad = (n: number) => String(n).padStart(2, '0');
function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** A follow-up date as YYYY-MM-DD: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD or an Excel date number. Null when it is not a date. */
export function parseFollowUpDate(raw: string): string | null {
  const t = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    // Excel stores a date as the number of days since 30 Dec 1899
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
    return validDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  return null;
}

const LABEL: Record<string, string> = Object.fromEntries(LEAD_UPLOAD_COLUMNS.map(c => [c.key, c.label]));
const FIELD_COLUMN: Record<keyof LeadUploadLeadInput, LeadUploadField> = {
  name: 'name', company: 'company', phone: 'phone', email: 'email', city: 'location', businessCategory: 'businessType',
  leadSource: 'leadSource', nextFollowUpAt: 'followUpDate', notes: 'description'
};

export interface LeadUploadPreparedRow {
  row: number;
  /** what is wrong with the row (several problems joined), or null */
  problem: string | null;
  fields: LeadUploadLeadInput | null;
  services: string[];
  assignee: string;
}

/** One file row -> the Add Lead values (same rules as the form). The database checks the services, the owner and duplicates. */
export function prepareLeadUploadRow(raw: LeadUploadRawRow): LeadUploadPreparedRow {
  const problems: string[] = [];
  const text = (k: LeadUploadField) => (raw[k] ?? '').trim();
  let nextFollowUpAt: string | null = null;
  if (text('followUpDate')) {
    const day = parseFollowUpDate(text('followUpDate'));
    if (day) nextFollowUpAt = `${day}T10:00:00+05:30`;
    else problems.push('Follow-up Date: use DD-MM-YYYY or YYYY-MM-DD.');
  }
  const source = text('leadSource');
  const contact = text('contactPerson');
  const notes = [contact && contact.toLowerCase() !== text('name').toLowerCase() ? `Contact person: ${contact}` : '', text('description')].filter(Boolean).join('\n');
  const parsed = leadUploadLeadSchema.safeParse({
    name: text('name'),
    company: text('company'),
    phone: cleanIndianMobile(text('phone')) || text('phone'),
    email: text('email') || null,
    city: text('location') || null,
    businessCategory: text('businessType') || null,
    leadSource: source ? KNOWN_SOURCES.find(s => s.toLowerCase() === source.toLowerCase()) ?? source : 'Other',
    nextFollowUpAt,
    notes: notes || null
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const column = LABEL[FIELD_COLUMN[issue.path[0] as keyof LeadUploadLeadInput]] ?? 'Row';
      const message = /^String must contain at most/.test(issue.message) ? 'is too long.' : issue.message;
      problems.push(`${column}: ${message}`);
    }
  }
  const services = Array.from(new Set(text('services').split(/[;,|\n]+/).map(s => s.trim()).filter(Boolean)));
  if (services.length === 0) problems.push('Interested Service: enter at least one service.');
  if (services.length > 40) problems.push('Interested Service: at most 40 services.');
  return {
    row: raw.row,
    problem: problems.length ? problems.join(' ').slice(0, 500) : null,
    fields: parsed.success ? parsed.data : null,
    services,
    assignee: text('assignee').slice(0, 254)
  };
}
