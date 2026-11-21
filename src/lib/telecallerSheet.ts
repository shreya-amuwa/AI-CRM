import { CONTACT_SAMPLE_HEADINGS, isContactSampleRow } from '../../shared/sampleSheets';
import type { Cell } from './xlsxReader';

/** Reads the contact sheet a Department Head assigns to a Telecaller: finds the columns by their headings and cleans each row. */
export interface SheetRow {
  row: number;
  name: string;
  company: string;
  phone: string;
  email: string;
  remarks: string;
}

export const SHEET_COLUMNS = CONTACT_SAMPLE_HEADINGS;
export const MAX_SHEET_ROWS = 2000;

const ALIASES: Record<keyof Omit<SheetRow, 'row'>, string[]> = {
  name: ['contact name', 'name', 'customer name', 'full name', 'person name', 'client name'],
  company: ['company name', 'company', 'business name', 'business', 'organisation', 'organization', 'firm'],
  phone: ['phone number', 'phone', 'mobile', 'mobile number', 'mobile no', 'contact number', 'contact no', 'phone no', 'cell', 'whatsapp number'],
  email: ['email', 'e-mail', 'email address', 'email id', 'mail'],
  remarks: ['remarks', 'remark', 'notes', 'note', 'comments', 'comment']
};

const norm = (v: Cell) => String(v ?? '').toLowerCase().replace(/[\s_*:.]+/g, ' ').trim();

/** A cell as text; whole numbers (a phone typed as a number in Excel) are written out in full, never as 9.8E+9. */
export function cellText(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : String(v)) : '';
  return v.trim();
}

/** `sampleSkipped`: the sample row of the downloadable sample sheet (Contact_Name, 9000000000) was in the file and was left out. */
export function parseContactSheet(sheetRows: Cell[][]): { rows: SheetRow[]; problem?: string; skipped: number; sampleSkipped?: boolean } {
  const headerIndex = sheetRows.findIndex(r => r.some(c => cellText(c) !== ''));
  if (headerIndex < 0) return { rows: [], problem: 'The sheet is empty.', skipped: 0 };
  const header = sheetRows[headerIndex].map(norm);
  const col: Partial<Record<keyof Omit<SheetRow, 'row'>, number>> = {};
  for (const key of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) {
    const at = header.findIndex(h => ALIASES[key].includes(h));
    if (at >= 0) col[key] = at;
  }
  const missing = [col.name === undefined ? 'Contact Name' : '', col.phone === undefined ? 'Phone Number' : ''].filter(Boolean);
  if (missing.length) {
    return { rows: [], problem: `The first row must have the headings ${SHEET_COLUMNS.join(', ')}. Missing: ${missing.join(' and ')}.`, skipped: 0 };
  }
  const rows: SheetRow[] = [];
  let skipped = 0;
  let sampleSkipped = false;
  for (let i = headerIndex + 1; i < sheetRows.length; i++) {
    const r = sheetRows[i] ?? [];
    const get = (k: keyof typeof ALIASES) => (col[k] === undefined ? '' : cellText(r[col[k]!] ?? null));
    const row: SheetRow = { row: i + 1, name: get('name'), company: get('company'), phone: get('phone'), email: get('email'), remarks: get('remarks') };
    if (!row.name && !row.company && !row.phone && !row.email && !row.remarks) {
      if (r.some(c => cellText(c) !== '')) skipped++; // a row with other columns only: nothing to call
      continue;
    }
    // the sample row of the downloadable sample sheet is never a contact
    if (isContactSampleRow(row.name, row.phone)) {
      sampleSkipped = true;
      continue;
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    return { rows, problem: sampleSkipped ? 'The sheet only has the sample row. Replace it with your contacts, or add them below it.' : 'The sheet has no contact rows below the headings.', skipped, sampleSkipped };
  }
  if (rows.length > MAX_SHEET_ROWS) return { rows: [], problem: `A sheet can have at most ${MAX_SHEET_ROWS.toLocaleString('en-IN')} contacts; this one has ${rows.length.toLocaleString('en-IN')}. Split it into smaller sheets.`, skipped };
  return { rows, skipped, sampleSkipped };
}

/** SHA-256 of the file (hex): identifies the sheet so the same file is not assigned twice to one person. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
