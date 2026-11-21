import { CUSTOMER_SAMPLE_COMPANY, CUSTOMER_SAMPLE_NAME, SAMPLE_EMAIL, SAMPLE_PHONE, isCustomerSampleRow } from '../../shared/sampleSheets';
import { csvCell, parseCsv } from './csv';
import {
  CUSTOMER_STATUS_LABELS,
  SEGMENT_LABELS,
  type CustomerInput,
  type CustomerSegmentValue,
  type CustomerStatusValue,
  type ServiceOption
} from './support';

/** What the uploaded sheet must look like: one customer per row, these column titles. */
export const IMPORT_COLUMNS = ['Name', 'Company', 'Phone', 'Email', 'Type', 'Status', 'Service', 'Requirement', 'Channel', 'Notes'] as const;
export const IMPORT_MAX_ROWS = 500;

const ALIASES: Record<string, (typeof IMPORT_COLUMNS)[number]> = {
  name: 'Name', 'customer name': 'Name', 'full name': 'Name', 'customer full name': 'Name',
  company: 'Company', business: 'Company', 'company name': 'Company', organization: 'Company', organisation: 'Company',
  phone: 'Phone', mobile: 'Phone', 'phone number': 'Phone', 'mobile number': 'Phone', contact: 'Phone',
  email: 'Email', 'e-mail': 'Email', 'email address': 'Email',
  type: 'Type', 'customer type': 'Type', segment: 'Type',
  status: 'Status', 'customer status': 'Status',
  service: 'Service', services: 'Service', product: 'Service', 'service or product': 'Service',
  requirement: 'Requirement', requirements: 'Requirement',
  channel: 'Channel', 'communication channel': 'Channel',
  notes: 'Notes', note: 'Notes', remarks: 'Notes'
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CHANNELS = ['Phone', 'WhatsApp', 'Email', 'Walk-in', 'Website', 'Other'];

export interface ImportRow {
  /** Row number in the sheet (the header is row 1). */
  line: number;
  input: CustomerInput | null;
  errors: string[];
  name: string;
  contact: string;
}

export interface ImportParse {
  rows: ImportRow[];
  /** A problem with the whole file (no rows, missing Name column, too many rows). */
  fileError: string | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Reads the sheet and checks every row with the same rules as the Add Customer form. */
export function parseCustomerSheet(text: string, services: ServiceOption[], assigneeId?: string): ImportParse {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], fileError: 'The file has no customers. Use the template: one customer per row under the column titles.' };
  const header = table[0].map(h => ALIASES[norm(h)] ?? null);
  if (!header.includes('Name')) return { rows: [], fileError: 'The first row must have a "Name" column. Download the template to see the columns.' };
  if (table.length - 1 > IMPORT_MAX_ROWS) return { rows: [], fileError: `A file can have up to ${IMPORT_MAX_ROWS} customers. Split it into smaller files.` };

  const segmentOf = (v: string): CustomerSegmentValue | null => {
    const k = norm(v);
    return (Object.entries(SEGMENT_LABELS).find(([code, label]) => k === norm(label) || k === code.toLowerCase())?.[0] as CustomerSegmentValue) ?? null;
  };
  const statusOf = (v: string): CustomerStatusValue | null => {
    const k = norm(v);
    return (Object.entries(CUSTOMER_STATUS_LABELS).find(([code, label]) => k === norm(label) || k === code.toLowerCase())?.[0] as CustomerStatusValue) ?? null;
  };
  const serviceOf = (v: string) => {
    const k = norm(v);
    return services.find(s => norm(s.name) === k || s.code.toLowerCase() === k) ?? null;
  };

  const seen = new Set<string>();
  // the sample row of the downloadable template is never a customer (the line numbers stay the file's own)
  const nameAt = header.indexOf('Name');
  const phoneAt = header.indexOf('Phone');
  const sample = (cells: string[]) => isCustomerSampleRow(cells[nameAt] ?? '', phoneAt >= 0 ? cells[phoneAt] ?? '' : '');
  const rows: ImportRow[] = table.slice(1).map((cells, i) => ({ cells, i })).filter(r => !sample(r.cells)).map(({ cells, i }) => {
    const get = (col: (typeof IMPORT_COLUMNS)[number]) => (cells[header.indexOf(col)] ?? '').trim();
    const errors: string[] = [];
    const name = get('Name');
    const phone = get('Phone');
    const email = get('Email').toLowerCase();
    if (name.length < 2) errors.push('Enter the customer’s full name.');
    if (!phone && !email) errors.push('Enter a phone number or an e-mail address.');
    if (email && !EMAIL_RE.test(email)) errors.push('The e-mail address is not valid.');
    if (phone && (!/^[0-9+()\-\s.]{5,25}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) errors.push('The phone number is not valid (at least 7 digits).');

    const typeText = get('Type');
    const segment = typeText ? segmentOf(typeText) : 'RETAIL';
    if (!segment) errors.push(`Type "${typeText}" is not one of: ${Object.values(SEGMENT_LABELS).join(', ')}.`);
    const statusText = get('Status');
    const status = statusText ? statusOf(statusText) : 'ACTIVE';
    if (!status) errors.push(`Status "${statusText}" is not one of: ${Object.values(CUSTOMER_STATUS_LABELS).join(', ')}.`);

    const picked: CustomerInput['services'] = [];
    for (const part of get('Service').split(/[;|]/).map(p => p.trim()).filter(Boolean)) {
      const svc = serviceOf(part);
      if (!svc) errors.push(`Service "${part}" is not in the service list.`);
      else if (!picked.some(p => p.serviceCode === svc.code)) picked.push({ serviceCode: svc.code, serviceDetails: {} });
    }

    const channelText = get('Channel');
    const channel = !channelText ? 'Phone' : (CHANNELS.find(c => norm(c) === norm(channelText)) ?? null);
    if (!channel) errors.push(`Channel "${channelText}" is not one of: ${CHANNELS.join(', ')}.`);

    // the same person twice in one file (the same phone number or the same e-mail address)
    const keys = [email && `e:${email}`, phone && phone.replace(/\D/g, '').length >= 7 ? `p:${phone.replace(/\D/g, '').slice(-10)}` : ''].filter(Boolean) as string[];
    if (keys.some(k => seen.has(k))) errors.push('This customer appears twice in the file (same phone number or e-mail).');
    keys.forEach(k => seen.add(k));

    const input: CustomerInput | null = errors.length
      ? null
      : {
          name,
          company: get('Company'),
          phone,
          email,
          segment: segment as CustomerSegmentValue,
          status: status as CustomerStatusValue,
          services: picked,
          requirement: get('Requirement'),
          channel: channel as string,
          notes: get('Notes'),
          assigneeId
        };
    return { line: i + 2, input, errors, name: name || '(no name)', contact: [phone, email].filter(Boolean).join(' · ') };
  });
  if (rows.length === 0) return { rows, fileError: 'The file only has the sample row. Replace it with your customers, or add them below it.' };
  return { rows, fileError: null };
}

/** The downloadable template: the column titles and one example row. */
export function importTemplate(services: ServiceOption[]): string {
  // dummy details (docs: shared/sampleSheets.ts): placeholders, never a real person; the upload skips this row
  const example = [CUSTOMER_SAMPLE_NAME, CUSTOMER_SAMPLE_COMPANY, SAMPLE_PHONE, SAMPLE_EMAIL, 'Retail', 'Active', services[0]?.name ?? '', 'Requirement_Details', 'Phone', ''];
  return [IMPORT_COLUMNS.join(','), example.map(csvCell).join(',')].join('\r\n') + '\r\n';
}
