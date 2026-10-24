import type { Cell, Workbook } from './xlsxReader';

/**
 * Reads the "Existing Customers - Services & Usage" Excel template into the rows the server checks.
 * Only the columns the team types in are read; calculated columns (Days Left, Messages Left, % Used ...)
 * are worked out again on the dashboard. Every check that matters is done by the database; this only
 * finds the sheets, the header row and turns Excel dates / numbers into plain values.
 */
export type SheetKey = 'customers' | 'services' | 'whatsapp' | 'campaigns' | 'aiCalling' | 'rcsVoice' | 'monthly';
type Kind = 'text' | 'num' | 'date' | 'month' | 'mobile';
type Row = { row: number } & Record<string, string | number | null>;
export type ImportData = Partial<Record<SheetKey, Row[]>>;

interface SheetSpec {
  key: SheetKey;
  /** The tab name in the template (matched without the number, any case). */
  title: string;
  match: RegExp;
  columns: Record<string, [field: string, kind: Kind]>;
  /**
   * Fields the template fills in by itself for a row (the mobile list of the customers who have this service, their name, the date the
   * subscription ends, "Data as of"). A row where only these have a value is a row nobody has typed anything into yet: it is skipped.
   */
  auto?: string[];
}

export const IMPORT_SHEETS: SheetSpec[] = [
  {
    key: 'customers', title: '1 Customers', match: /customers/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], 'customer name': ['name', 'text'], 'business name': ['businessName', 'text'], 'e-mail': ['email', 'text'],
      city: ['city', 'text'], 'business address': ['address', 'text'], 'business category': ['category', 'text'], 'customer since': ['customerSince', 'date'],
      'support team member': ['member', 'text'], 'client login e-mail': ['loginEmail', 'text'], 'client password': ['loginPassword', 'text'],
      'sold by (sales)': ['soldBy', 'text'], notes: ['notes', 'text']
    }
  },
  {
    key: 'services', title: '2 Services', match: /services/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], 'plan / package name': ['plan', 'text'], 'price paid (₹, excl. gst)': ['price', 'num'],
      'billing cycle': ['billingCycle', 'text'], 'start date': ['startDate', 'date'], 'renewal / expiry date': ['renewsOn', 'date'], status: ['status', 'text'],
      'panel / platform': ['platform', 'text'], 'panel login e-mail / account id': ['panelAccount', 'text'], notes: ['notes', 'text']
    }
  },
  {
    key: 'whatsapp', title: '3 WhatsApp Account', match: /whatsapp account/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], 'whatsapp api number': ['apiNumber', 'mobile'], 'waba id': ['wabaId', 'mobile'], 'display name': ['displayName', 'text'],
      'blue tick': ['blueTick', 'text'], 'quality rating': ['quality', 'text'], 'messaging limit': ['messagingLimit', 'text'], 'message package': ['packageName', 'text'],
      'messages in package': ['packageMessages', 'num'], 'extra messages added': ['extraMessages', 'num'], 'messages sent (total)': ['sent', 'num'],
      'messages delivered (total)': ['delivered', 'num'], 'messages read (total)': ['read', 'num'], 'replies (total)': ['replied', 'num'], 'failed (total)': ['failed', 'num'],
      'campaigns sent (total)': ['campaigns', 'num'], 'subscription ends': ['validUntil', 'date'], 'data as of': ['asOf', 'date']
    },
    auto: ['mobile', 'displayName', 'validUntil', 'asOf']
  },
  {
    key: 'campaigns', title: '4 WhatsApp Campaigns', match: /campaigns/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], 'campaign name': ['name', 'text'], 'template name': ['template', 'text'], 'sent on': ['sentOn', 'date'],
      'audience type': ['audienceType', 'text'], 'audience size': ['audienceSize', 'num'], sent: ['sent', 'num'], delivered: ['delivered', 'num'], read: ['read', 'num'],
      replied: ['replied', 'num'], failed: ['failed', 'num'], 'campaign status': ['status', 'text']
    }
  },
  {
    key: 'aiCalling', title: '5 AI Calling', match: /ai calling/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], platform: ['platform', 'text'], 'calling plan': ['plan', 'text'], 'calling number(s)': ['numbers', 'mobile'],
      'ai agent name': ['agent', 'text'], 'credits bought (₹)': ['creditsBought', 'num'], 'credits left (₹)': ['creditsLeft', 'num'], 'minutes bought': ['minutesBought', 'num'],
      'minutes left': ['minutesLeft', 'num'], 'total calls': ['totalCalls', 'num'], 'connected calls': ['connectedCalls', 'num'], 'not answered': ['notAnswered', 'num'],
      'interested / leads': ['interested', 'num'], 'ai campaigns run': ['campaigns', 'num'], 'contacts uploaded': ['contacts', 'num'],
      'plan valid until': ['validUntil', 'date'], 'data as of': ['asOf', 'date']
    },
    auto: ['mobile', 'platform', 'validUntil', 'asOf']
  },
  {
    key: 'rcsVoice', title: '6 RCS & Voice', match: /rcs/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], 'sender id / brand name': ['senderId', 'text'], 'package (messages)': ['packageMessages', 'num'],
      sent: ['sent', 'num'], delivered: ['delivered', 'num'], 'read / answered': ['read', 'num'], 'clicks / replies': ['clicks', 'num'], failed: ['failed', 'num'],
      'campaigns run': ['campaigns', 'num'], 'valid until': ['validUntil', 'date'], 'data as of': ['asOf', 'date']
    },
    auto: ['mobile', 'service', 'validUntil', 'asOf']
  },
  {
    key: 'monthly', title: '7 Monthly Deliverables', match: /monthly/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], month: ['month', 'month'], 'what is delivered (unit)': ['unit', 'text'],
      'included in plan': ['included', 'num'], delivered: ['delivered', 'num'], 'result 1 - name': ['result1Name', 'text'], 'result 1 - value': ['result1Value', 'text'],
      'result 2 - name': ['result2Name', 'text'], 'result 2 - value': ['result2Value', 'text'], 'link (page / profile / website)': ['link', 'text'], notes: ['notes', 'text']
    }
  }
];

/** The template's example rows use this mobile number (or say EXAMPLE); they are never imported. */
const EXAMPLE_MOBILE = '9820011111';
/** Columns the template calculates itself (shown again on the dashboard, so not imported). */
const CALCULATED = new Set(['customer (auto)', 'days left', 'messages left', '% used', 'delivery %', 'read %', 'reply %', 'minutes used', 'left', 'pending']);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const header = (v: Cell) => String(v ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** An Excel date serial (days since 1899-12-30). */
function serialDate(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function convert(v: Cell, kind: Kind): string | number | null {
  if (v === null || v === '') return null;
  switch (kind) {
    case 'mobile':
      return typeof v === 'number' ? String(Math.round(v)) : v;
    case 'num': {
      if (typeof v === 'number') return v;
      const n = Number(v.replace(/[₹,\s]/g, ''));
      return Number.isFinite(n) && v.replace(/[₹,\s]/g, '') !== '' ? n : v;
    }
    case 'date': {
      if (typeof v === 'number') return serialDate(v);
      let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
      if (m) return iso(+m[3], +m[2], +m[1]);
      m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
      return m ? iso(+m[1], +m[2], +m[3]) : v;
    }
    case 'month': {
      if (typeof v === 'number') return serialDate(v).slice(0, 7);
      const t = v.toLowerCase();
      let m = /^([a-z]{3})[a-z]*[-\s/']*(\d{4})$/.exec(t);
      if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
      m = /^(\d{1,2})[-/](\d{4})$/.exec(t);
      if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
      m = /^(\d{4})-(\d{1,2})/.exec(t);
      return m ? `${m[1]}-${m[2].padStart(2, '0')}` : v;
    }
    default:
      return typeof v === 'number' ? String(v) : v;
  }
}

export interface ParsedImport {
  data: ImportData;
  counts: Record<SheetKey, number>;
  /** Template tabs that were not found in the file (fine when the customers have no such service). */
  missing: string[];
  /** Columns with a heading the import does not know (they are ignored). */
  ignored: string[];
  /** "tabs": the template with one tab per kind of data; "one-sheet": the single "Import" tab with a Record type on every row. */
  format: 'tabs' | 'one-sheet';
  /** Rows that cannot be read at all (an unknown Record type, data without one). They stop the save, like a problem the server finds. */
  problems: { row: number; message: string }[];
  /** Things typed in a column that does not apply to that row's Record type (they are ignored): worth a look, they do not stop the save. */
  warnings: string[];
}

/**
 * The single-tab template ("Import"): one row per record, the first column says what kind of record it is. Every kind uses only
 * its own columns (the sheet greys out the rest); columns that mean the same thing (Sent, Delivered, Valid Until ...) are shared.
 */
export const ONE_SHEET_TYPES: { key: SheetKey; label: string; aliases: string[]; columns: Record<string, [field: string, kind: Kind]> }[] = [
  {
    key: 'customers', label: 'Customer', aliases: ['customer', 'customers'],
    columns: {
      'mobile number': ['mobile', 'mobile'], 'customer name': ['name', 'text'], 'business name': ['businessName', 'text'], 'e-mail': ['email', 'text'], city: ['city', 'text'],
      'business address': ['address', 'text'], 'business category': ['category', 'text'], 'customer since': ['customerSince', 'date'], 'support team member': ['member', 'text'],
      'client login e-mail': ['loginEmail', 'text'], 'client password': ['loginPassword', 'text'], 'sold by (sales)': ['soldBy', 'text'], notes: ['notes', 'text']
    }
  },
  {
    key: 'services', label: 'Service', aliases: ['service', 'services'],
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], 'plan / package name': ['plan', 'text'], 'price paid (₹, excl. gst)': ['price', 'num'],
      'billing cycle': ['billingCycle', 'text'], 'start date': ['startDate', 'date'], 'renewal / expiry date': ['renewsOn', 'date'], status: ['status', 'text'],
      'panel / platform': ['platform', 'text'], 'panel login e-mail / account id': ['panelAccount', 'text'], notes: ['notes', 'text']
    }
  },
  {
    key: 'whatsapp', label: 'WhatsApp account', aliases: ['whatsapp account', 'whatsapp'],
    columns: {
      'mobile number': ['mobile', 'mobile'], 'whatsapp api number': ['apiNumber', 'mobile'], 'waba id': ['wabaId', 'mobile'], 'display name': ['displayName', 'text'],
      'blue tick': ['blueTick', 'text'], 'quality rating': ['quality', 'text'], 'messaging limit': ['messagingLimit', 'text'], 'message package': ['packageName', 'text'],
      'messages in package': ['packageMessages', 'num'], 'extra messages added': ['extraMessages', 'num'], sent: ['sent', 'num'], delivered: ['delivered', 'num'],
      'read / answered': ['read', 'num'], replied: ['replied', 'num'], failed: ['failed', 'num'], 'campaigns sent / run': ['campaigns', 'num'],
      'valid until': ['validUntil', 'date'], 'data as of': ['asOf', 'date']
    }
  },
  {
    key: 'campaigns', label: 'WhatsApp campaign', aliases: ['whatsapp campaign', 'campaign', 'campaigns'],
    columns: {
      'mobile number': ['mobile', 'mobile'], 'campaign name': ['name', 'text'], 'template name': ['template', 'text'], 'sent on': ['sentOn', 'date'],
      'audience type': ['audienceType', 'text'], 'audience size': ['audienceSize', 'num'], sent: ['sent', 'num'], delivered: ['delivered', 'num'],
      'read / answered': ['read', 'num'], replied: ['replied', 'num'], failed: ['failed', 'num'], 'campaign status': ['status', 'text']
    }
  },
  {
    key: 'aiCalling', label: 'AI Calling', aliases: ['ai calling'],
    columns: {
      'mobile number': ['mobile', 'mobile'], 'panel / platform': ['platform', 'text'], 'calling plan': ['plan', 'text'], 'calling number(s)': ['numbers', 'mobile'],
      'ai agent name': ['agent', 'text'], 'credits bought (₹)': ['creditsBought', 'num'], 'credits left (₹)': ['creditsLeft', 'num'], 'minutes bought': ['minutesBought', 'num'],
      'minutes left': ['minutesLeft', 'num'], 'total calls': ['totalCalls', 'num'], 'connected calls': ['connectedCalls', 'num'], 'not answered': ['notAnswered', 'num'],
      'interested / leads': ['interested', 'num'], 'campaigns sent / run': ['campaigns', 'num'], 'contacts uploaded': ['contacts', 'num'],
      'valid until': ['validUntil', 'date'], 'data as of': ['asOf', 'date']
    }
  },
  {
    key: 'rcsVoice', label: 'RCS / Voice', aliases: ['rcs / voice', 'rcs/voice', 'rcs & voice', 'rcs', 'voice'],
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], 'sender id / brand name': ['senderId', 'text'], 'messages in package': ['packageMessages', 'num'],
      sent: ['sent', 'num'], delivered: ['delivered', 'num'], 'read / answered': ['read', 'num'], 'clicks / key-press replies': ['clicks', 'num'], failed: ['failed', 'num'],
      'campaigns sent / run': ['campaigns', 'num'], 'valid until': ['validUntil', 'date'], 'data as of': ['asOf', 'date']
    }
  },
  {
    key: 'monthly', label: 'Monthly deliverable', aliases: ['monthly deliverable', 'monthly', 'monthly deliverables'],
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], month: ['month', 'month'], 'what is delivered (unit)': ['unit', 'text'], 'included in plan': ['included', 'num'],
      delivered: ['delivered', 'num'], 'result 1 - name': ['result1Name', 'text'], 'result 1 - value': ['result1Value', 'text'], 'result 2 - name': ['result2Name', 'text'],
      'result 2 - value': ['result2Value', 'text'], 'link (page / profile / website)': ['link', 'text'], notes: ['notes', 'text']
    }
  }
];

/** The name the server uses for each kind of record in its messages ("4 WhatsApp Campaigns, row 7"), as the person sees it in the one-tab template. */
export const SHEET_LABEL: Record<string, string> = {
  '1 Customers': 'Customer', '2 Services': 'Service', '3 WhatsApp Account': 'WhatsApp account', '4 WhatsApp Campaigns': 'WhatsApp campaign',
  '5 AI Calling': 'AI Calling', '6 RCS & Voice': 'RCS / Voice', '7 Monthly Deliverables': 'Monthly deliverable'
};

function parseOneSheet(sheet: { name: string; rows: Cell[][] }, hdr: number): ParsedImport {
  const data: ImportData = {};
  const counts = Object.fromEntries(IMPORT_SHEETS.map(s => [s.key, 0])) as Record<SheetKey, number>;
  const ignored: string[] = [];
  const problems: ParsedImport['problems'] = [];
  const warnings: string[] = [];
  const known = new Set(ONE_SHEET_TYPES.flatMap(t => Object.keys(t.columns)));
  const head = (sheet.rows[hdr] ?? []).map(h => header(h));
  head.forEach((key, j) => {
    if (key && key !== 'record type' && !known.has(key) && !CALCULATED.has(key) && !key.endsWith('(helper)')) ignored.push(`${sheet.name}: ${String(sheet.rows[hdr]?.[j])}`);
  });
  const typeOf = (v: Cell) => {
    const t = String(v ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return t ? ONE_SHEET_TYPES.find(x => x.aliases.includes(t)) ?? null : null;
  };
  for (let i = hdr + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i] ?? [];
    const raw = cells[0] ?? null;
    const t = typeOf(raw);
    const typed = (j: number) => {
      const key = head[j];
      return j > 0 && !!key && known.has(key) && !CALCULATED.has(key) && cells[j] !== null && cells[j] !== undefined && cells[j] !== '';
    };
    if (!t) {
      if (raw !== null && raw !== '') problems.push({ row: i + 1, message: `Record type "${String(raw)}" is not one of: ${ONE_SHEET_TYPES.map(x => x.label).join(', ')}.` });
      else if (head.some((_, j) => typed(j))) problems.push({ row: i + 1, message: 'Choose the Record type for this row (Customer, Service, WhatsApp account ...).' });
      continue;
    }
    const out: Row = { row: i + 1 };
    for (const [key, [field, kind]] of Object.entries(t.columns)) {
      const j = head.indexOf(key);
      out[field] = j < 0 ? null : convert(cells[j] ?? null, kind);
    }
    const mobile = String(out.mobile ?? '').replace(/\D/g, '');
    if (mobile === EXAMPLE_MOBILE || cells.some(x => typeof x === 'string' && /\bEXAMPLE\b/.test(x))) continue;
    head.forEach((key, j) => {
      if (warnings.length < 20 && typed(j) && !t.columns[key]) warnings.push(`Row ${i + 1}: "${String(sheet.rows[hdr]?.[j])}" is not used by a ${t.label} row, so it was ignored.`);
    });
    (data[t.key] ??= []).push(out);
    counts[t.key]++;
  }
  return { data, counts, missing: [], ignored, format: 'one-sheet', problems, warnings };
}

export function parseExistingCustomers(wb: Workbook): ParsedImport {
  for (const sheet of wb.sheets) {
    const hdr = sheet.rows.slice(0, 6).findIndex(r => header(r?.[0]) === 'record type');
    if (hdr >= 0 && !/guide|how to|lists/i.test(sheet.name)) return parseOneSheet(sheet, hdr);
  }
  const data: ImportData = {};
  const counts = Object.fromEntries(IMPORT_SHEETS.map(s => [s.key, 0])) as Record<SheetKey, number>;
  const missing: string[] = [];
  const ignored: string[] = [];
  for (const spec of IMPORT_SHEETS) {
    const sheet = wb.sheets.find(s => spec.match.test(s.name.replace(/^\s*\d+\s*/, '')) && !/guide|how to|lists/i.test(s.name));
    if (!sheet) {
      missing.push(spec.title);
      continue;
    }
    const hdr = sheet.rows.slice(0, 6).findIndex(r => header(r?.[0]) === 'mobile number');
    if (hdr < 0) {
      throw new Error(`Sheet "${sheet.name}": the first column must be "Mobile Number". Use the CRM's Excel template.`);
    }
    const cols = (sheet.rows[hdr] ?? []).map(h => {
      const key = header(h);
      if (key && !spec.columns[key] && !CALCULATED.has(key) && !key.endsWith('(helper)')) ignored.push(`${sheet.name}: ${String(h)}`);
      return spec.columns[key] ?? null;
    });
    const rows: Row[] = [];
    for (let i = hdr + 1; i < sheet.rows.length; i++) {
      const cells = sheet.rows[i] ?? [];
      const out: Row = { row: i + 1 };
      let filled = false;
      cols.forEach((c, j) => {
        if (!c) return;
        const v = convert(cells[j] ?? null, c[1]);
        out[c[0]] = v;
        if (v !== null && !spec.auto?.includes(c[0])) filled = true;
      });
      if (!filled) continue;
      const mobile = String(out.mobile ?? '').replace(/\D/g, '');
      if (mobile === EXAMPLE_MOBILE || cells.some(x => typeof x === 'string' && /\bEXAMPLE\b/.test(x))) continue;
      rows.push(out);
    }
    if (rows.length) data[spec.key] = rows;
    counts[spec.key] = rows.length;
  }
  return { data, counts, missing, ignored, format: 'tabs', problems: [], warnings: [] };
}
