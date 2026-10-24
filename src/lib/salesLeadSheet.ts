import { cellText } from './telecallerSheet';
import type { Cell } from './xlsxReader';

/**
 * Reads the contact sheet the Sales Department Head gives to a Telecaller. The first non-empty row is the heading row; each column is matched to a lead field by
 * its heading (the usual names are known) and the head can correct the match before the sheet is checked. The database checks every value again.
 */
export const LEAD_FIELDS = [
  { key: 'name', label: 'Contact Name', required: true },
  { key: 'company', label: 'Company Name', required: false },
  { key: 'phone', label: 'Phone Number', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'remarks', label: 'Remarks', required: false }
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number]['key'];
export type LeadMapping = Partial<Record<LeadField, number>>;
export const MAX_LEAD_ROWS = 2000;

const ALIASES: Record<LeadField, string[]> = {
  name: ['customer name', 'name', 'contact name', 'full name', 'client name', 'person name', 'lead name'],
  company: ['company', 'company name', 'business name', 'business', 'company business name', 'company / business name', 'organisation', 'organization', 'firm'],
  phone: ['phone number', 'phone', 'mobile', 'mobile number', 'mobile no', 'contact number', 'contact no', 'phone no', 'cell', 'whatsapp number'],
  email: ['email', 'e-mail', 'email address', 'email id', 'mail'],
  remarks: ['remarks', 'remark', 'notes', 'note', 'comments', 'comment']
};

const norm = (v: Cell) => String(v ?? '').toLowerCase().replace(/[\s_*:./-]+/g, ' ').trim();

export interface LeadSheetRead {
  headers: string[];
  headerRow: number;
  mapping: LeadMapping;
  /** the rows below the heading row, as read from the file */
  body: { row: number; cells: Cell[] }[];
  problem?: string;
}

/** Find the heading row and guess the mapping. */
export function readLeadSheet(sheetRows: Cell[][]): LeadSheetRead {
  const headerIndex = sheetRows.findIndex(r => r.some(c => cellText(c) !== ''));
  if (headerIndex < 0) return { headers: [], headerRow: 0, mapping: {}, body: [], problem: 'The sheet is empty.' };
  const headers = sheetRows[headerIndex].map(c => cellText(c));
  const mapping: LeadMapping = {};
  const taken = new Set<number>();
  for (const f of LEAD_FIELDS) {
    const wanted = ALIASES[f.key].map(a => norm(a));
    const at = headers.findIndex((h, i) => !taken.has(i) && wanted.includes(norm(h)));
    if (at >= 0) {
      mapping[f.key] = at;
      taken.add(at);
    }
  }
  const body = sheetRows
    .slice(headerIndex + 1)
    .map((cells, i) => ({ row: headerIndex + i + 2, cells }))
    .filter(r => r.cells.some(c => cellText(c) !== ''));
  if (body.length === 0) return { headers, headerRow: headerIndex + 1, mapping, body, problem: 'The sheet has no lead rows below the headings.' };
  if (body.length > MAX_LEAD_ROWS) {
    return { headers, headerRow: headerIndex + 1, mapping, body: [], problem: `A sheet can have at most ${MAX_LEAD_ROWS.toLocaleString('en-IN')} leads; this one has ${body.length.toLocaleString('en-IN')}. Split it into smaller sheets.` };
  }
  return { headers, headerRow: headerIndex + 1, mapping, body };
}

export const missingFields = (m: LeadMapping) => LEAD_FIELDS.filter(f => f.required && m[f.key] === undefined).map(f => f.label);

export interface LeadRowBody { row: number; name: string; company: string; phone: string; email: string; remarks: string }

/** Apply a mapping: one row body per non-empty row. */
export function buildLeadRows(read: LeadSheetRead, mapping: LeadMapping): LeadRowBody[] {
  const get = (cells: Cell[], k: LeadField) => (mapping[k] === undefined ? '' : cellText(cells[mapping[k]!] ?? null));
  return read.body.map(({ row, cells }) => ({
    row,
    name: get(cells, 'name'),
    company: get(cells, 'company'),
    phone: get(cells, 'phone'),
    email: get(cells, 'email'),
    remarks: get(cells, 'remarks')
  }));
}
