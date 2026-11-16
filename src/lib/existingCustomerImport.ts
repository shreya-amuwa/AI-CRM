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
  /** "tabs": the template with one tab per kind of data; "one-sheet": the single "Import" tab with a Record type on every row;
   *  "customer-rows": the Add Customer upload template, one row per customer with its Relationship Manager, client login and services side by side. */
  format: 'tabs' | 'one-sheet' | 'customer-rows';
  /** Rows that cannot be read at all (an unknown Record type, data without one). They stop the save, like a problem the server finds. */
  problems: { row: number; message: string }[];
  /** Things typed in a column that does not apply to that row's Record type (they are ignored): worth a look, they do not stop the save. */
  warnings: string[];
}

/**
 * The single-sheet template ("Import"): ONE plain table, one row per customer and service (plus a row per campaign or month). No "record type":
 * what a row holds is read from the blocks of columns that are filled in. Blocks:
 *   CUSTOMER       typed on the customer's first row only (the other rows of that customer carry just the mobile number)
 *   SERVICE        the service they bought: plan, price, dates, status
 *   WHATSAPP API   the account and its totals          WHATSAPP CAMPAIGN  one campaign
 *   AI CALLING     usage                               RCS / VOICE        usage
 *   MONTHLY WORK   one month of a service that has no usage panel (posts, reels, leads ...)
 * A block creates its record when any of its columns is filled. Headings are unique per block (Messages Sent (total) is the WhatsApp account,
 * Campaign Sent is a campaign), so nothing is ambiguous.
 */
export interface OneSheetBlock {
  key: SheetKey;
  /** The name of the block, as shown on the sheet and in the import screen. */
  label: string;
  columns: Record<string, [field: string, kind: Kind]>;
  /** Fields that do not make the block "filled" by themselves (the Service column is shared with other blocks). */
  shared?: string[];
  /** The Service column must be empty or contain this when the block is filled. */
  service?: RegExp;
}
export const ONE_SHEET_BLOCKS: OneSheetBlock[] = [
  {
    key: 'customers', label: 'Customer', shared: ['mobile'],
    columns: {
      'mobile number': ['mobile', 'mobile'], 'customer name': ['name', 'text'], 'business name': ['businessName', 'text'], 'e-mail': ['email', 'text'], city: ['city', 'text'],
      'business address': ['address', 'text'], 'business category': ['category', 'text'], 'customer since': ['customerSince', 'date'],
      'handled by - support team member': ['member', 'text'], 'brought by (sales / support)': ['broughtByType', 'text'], 'brought by - name': ['broughtBy', 'text'],
      'client login e-mail': ['loginEmail', 'text'], 'client password': ['loginPassword', 'text'], 'customer notes': ['notes', 'text']
    }
  },
  {
    key: 'services', label: 'Service', shared: ['mobile', 'service'],
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], 'plan / package name': ['plan', 'text'], 'price paid (₹, excl. gst)': ['price', 'num'],
      'billing cycle': ['billingCycle', 'text'], 'start date': ['startDate', 'date'], 'renewal / expiry date': ['renewsOn', 'date'], status: ['status', 'text'],
      'panel / platform': ['platform', 'text'], 'panel login e-mail / account id': ['panelAccount', 'text'], 'service notes': ['notes', 'text']
    }
  },
  {
    key: 'whatsapp', label: 'WhatsApp API', shared: ['mobile'], service: /whatsapp/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], 'whatsapp api number': ['apiNumber', 'mobile'], 'waba id': ['wabaId', 'mobile'], 'display name': ['displayName', 'text'],
      'blue tick': ['blueTick', 'text'], 'quality rating': ['quality', 'text'], 'messaging limit': ['messagingLimit', 'text'], 'message package': ['packageName', 'text'],
      'messages in package': ['packageMessages', 'num'], 'extra messages added': ['extraMessages', 'num'], 'messages sent (total)': ['sent', 'num'],
      'messages delivered (total)': ['delivered', 'num'], 'messages read (total)': ['read', 'num'], 'replies (total)': ['replied', 'num'], 'failed (total)': ['failed', 'num'],
      'campaigns sent (total)': ['campaigns', 'num'], 'subscription ends': ['validUntil', 'date'], 'whatsapp data as of': ['asOf', 'date']
    }
  },
  {
    key: 'campaigns', label: 'WhatsApp campaign', shared: ['mobile'], service: /whatsapp/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], 'campaign name': ['name', 'text'], 'template name': ['template', 'text'], 'sent on': ['sentOn', 'date'],
      'audience type': ['audienceType', 'text'], 'audience size': ['audienceSize', 'num'], 'campaign sent': ['sent', 'num'], 'campaign delivered': ['delivered', 'num'],
      'campaign read': ['read', 'num'], 'campaign replied': ['replied', 'num'], 'campaign failed': ['failed', 'num'], 'campaign status': ['status', 'text']
    }
  },
  {
    key: 'aiCalling', label: 'AI Calling', shared: ['mobile'], service: /ai calling/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], 'ai platform': ['platform', 'text'], 'calling plan': ['plan', 'text'], 'calling number(s)': ['numbers', 'mobile'],
      'ai agent name': ['agent', 'text'], 'credits bought (₹)': ['creditsBought', 'num'], 'credits left (₹)': ['creditsLeft', 'num'], 'minutes bought': ['minutesBought', 'num'],
      'minutes left': ['minutesLeft', 'num'], 'total calls': ['totalCalls', 'num'], 'connected calls': ['connectedCalls', 'num'], 'not answered': ['notAnswered', 'num'],
      'interested / leads': ['interested', 'num'], 'ai campaigns run': ['campaigns', 'num'], 'contacts uploaded': ['contacts', 'num'],
      'ai plan valid until': ['validUntil', 'date'], 'ai data as of': ['asOf', 'date']
    }
  },
  {
    key: 'rcsVoice', label: 'RCS / Voice', shared: ['mobile', 'service'], service: /rcs|voice/i,
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], 'sender id / brand name': ['senderId', 'text'], 'rcs / voice messages in package': ['packageMessages', 'num'],
      'rcs / voice sent': ['sent', 'num'], 'rcs / voice delivered': ['delivered', 'num'], 'rcs read / voice answered': ['read', 'num'],
      'rcs clicks / voice key-press replies': ['clicks', 'num'], 'rcs / voice failed': ['failed', 'num'], 'rcs / voice campaigns run': ['campaigns', 'num'],
      'rcs / voice valid until': ['validUntil', 'date'], 'rcs / voice data as of': ['asOf', 'date']
    }
  },
  {
    key: 'monthly', label: 'Monthly work', shared: ['mobile', 'service'],
    columns: {
      'mobile number': ['mobile', 'mobile'], service: ['service', 'text'], month: ['month', 'month'], 'what is delivered (unit)': ['unit', 'text'], 'included in plan': ['included', 'num'],
      'delivered this month': ['delivered', 'num'], 'result 1 - name': ['result1Name', 'text'], 'result 1 - value': ['result1Value', 'text'], 'result 2 - name': ['result2Name', 'text'],
      'result 2 - value': ['result2Value', 'text'], 'link (page / profile / website)': ['link', 'text'], 'monthly notes': ['notes', 'text']
    }
  }
];
/** What the sheet is recognised by (no tab of the older template has all of these). */
const ONE_SHEET_MARKERS = ['mobile number', 'business name', 'service'];

/** The name the server uses for each kind of record in its messages ("4 WhatsApp Campaigns, row 7"), as the person sees it on the one sheet. */
export const SHEET_LABEL: Record<string, string> = {
  '1 Customers': 'Customer', '2 Services': 'Service', '3 WhatsApp Account': 'WhatsApp API', '4 WhatsApp Campaigns': 'WhatsApp campaign',
  '5 AI Calling': 'AI Calling', '6 RCS & Voice': 'RCS / Voice', '7 Monthly Deliverables': 'Monthly work'
};

function parseOneSheet(sheet: { name: string; rows: Cell[][] }, hdr: number): ParsedImport {
  const data: ImportData = {};
  const counts = Object.fromEntries(IMPORT_SHEETS.map(s => [s.key, 0])) as Record<SheetKey, number>;
  const ignored: string[] = [];
  const problems: ParsedImport['problems'] = [];
  const warnings: string[] = [];
  const known = new Set(ONE_SHEET_BLOCKS.flatMap(b => Object.keys(b.columns)));
  const head = (sheet.rows[hdr] ?? []).map(h => header(h));
  head.forEach((key, j) => {
    if (key && !known.has(key) && !CALCULATED.has(key) && !key.endsWith('(helper)')) ignored.push(`${sheet.name}: ${String(sheet.rows[hdr]?.[j])}`);
  });
  const at = (key: string) => head.indexOf(key);
  for (let i = hdr + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i] ?? [];
    const val = (key: string, kind: Kind) => (at(key) < 0 ? null : convert(cells[at(key)] ?? null, kind));
    const mobile = String(val('mobile number', 'mobile') ?? '').replace(/\D/g, '');
    if (mobile === EXAMPLE_MOBILE || cells.some(x => typeof x === 'string' && /\bEXAMPLE\b/.test(x))) continue;
    const service = String(val('service', 'text') ?? '');
    const made: Row[] = [];
    const filled = new Map<SheetKey, boolean>();
    for (const b of ONE_SHEET_BLOCKS) {
      const out: Row = { row: i + 1 };
      let any = false;
      for (const [key, [field, kind]] of Object.entries(b.columns)) {
        const v = val(key, kind);
        out[field] = v;
        if (v !== null && !b.shared?.includes(field)) any = true;
      }
      filled.set(b.key, any);
      if (any) made.push(Object.assign(out, { __block: b.key } as never));
    }
    // a service record is made when its columns are filled; a Service chosen on a usage row alone is that usage row's service (the import adds it if missing)
    const usage = ['whatsapp', 'campaigns', 'aiCalling', 'rcsVoice', 'monthly'].some(k => filled.get(k as SheetKey));
    if (service && !filled.get('services') && !usage) made.push({ row: i + 1, mobile: val('mobile number', 'mobile'), service, __block: 'services' } as never);
    if (!made.length) continue;
    if (!mobile) {
      problems.push({ row: i + 1, message: 'The Mobile Number is missing (every row needs the number of its customer).' });
      continue;
    }
    for (const b of ONE_SHEET_BLOCKS) {
      if (!filled.get(b.key) || !b.service || !service) continue;
      if (!b.service.test(service)) problems.push({ row: i + 1, message: `The ${b.label} columns are filled, but the Service on this row is "${service}". Use another row for that service.` });
    }
    for (const rec of made) {
      const { __block, ...row } = rec as Row & { __block: SheetKey };
      (data[__block] ??= []).push(row as Row);
      counts[__block]++;
    }
  }
  return { data, counts, missing: [], ignored, format: 'one-sheet', problems, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The Add Customer upload template (public/templates/Customer_Upload_Template.xlsx): ONE row per customer. The customer, the Relationship
// Manager (the Support Team Member who looks after them), the client dashboard login and up to 5 services side by side ("Service 1",
// "Plan 1", ...). Each row becomes the same customer + service records as the one-sheet template, so the server checks and saves it in the
// same way (import_customer_data): who may import for whom, the services, and the client logins (created by the API, password never stored).
// ---------------------------------------------------------------------------------------------------------------------------------
export const CUSTOMER_ROW_SLOTS = 5;
const CUSTOMER_ROW_COLUMNS: Record<string, [field: string, kind: Kind]> = {
  'relationship manager': ['member', 'text'], 'customer name': ['name', 'text'], 'business name': ['businessName', 'text'], mobile: ['mobile', 'mobile'],
  'mobile number': ['mobile', 'mobile'], 'e-mail': ['email', 'text'], email: ['email', 'text'], city: ['city', 'text'],
  'client login e-mail': ['loginEmail', 'text'], 'client password': ['loginPassword', 'text'], notes: ['notes', 'text'], 'customer notes': ['notes', 'text']
};
/** Per service slot: "service 1", "plan 1", "price 1 (₹)", "billing cycle 1", "start date 1", "expiry date 1", "status 1". */
const slotField = (key: string): [field: string, kind: Kind, slot: number] | null => {
  const m = /^(service|plan|price|billing cycle|start date|expiry date|status) (\d)(?: \(₹\))?$/.exec(key);
  if (!m || +m[2] < 1 || +m[2] > CUSTOMER_ROW_SLOTS) return null;
  const f: Record<string, [string, Kind]> = {
    service: ['service', 'text'], plan: ['plan', 'text'], price: ['price', 'num'], 'billing cycle': ['billingCycle', 'text'],
    'start date': ['startDate', 'date'], 'expiry date': ['renewsOn', 'date'], status: ['status', 'text']
  };
  return [...f[m[1]], +m[2]];
};
const CUSTOMER_ROW_MARKERS = ['relationship manager', 'service 1'];

function parseCustomerRows(sheet: { name: string; rows: Cell[][] }, hdr: number): ParsedImport {
  const data: ImportData = {};
  const counts = Object.fromEntries(IMPORT_SHEETS.map(s => [s.key, 0])) as Record<SheetKey, number>;
  const ignored: string[] = [];
  const problems: ParsedImport['problems'] = [];
  const head = (sheet.rows[hdr] ?? []).map(h => header(h));
  head.forEach((key, j) => {
    if (key && !CUSTOMER_ROW_COLUMNS[key] && !slotField(key) && !key.endsWith('(helper)')) ignored.push(`${sheet.name}: ${String(sheet.rows[hdr]?.[j])}`);
  });
  for (let i = hdr + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i] ?? [];
    if (cells.some(x => typeof x === 'string' && /\bEXAMPLE\b/.test(x))) continue;
    const customer: Row = { row: i + 1 };
    const slots: Row[] = Array.from({ length: CUSTOMER_ROW_SLOTS }, () => ({ row: i + 1 }));
    const slotFilled = new Array(CUSTOMER_ROW_SLOTS).fill(false);
    let any = false;
    head.forEach((key, j) => {
      const v = convert(cells[j] ?? null, CUSTOMER_ROW_COLUMNS[key]?.[1] ?? slotField(key)?.[1] ?? 'text');
      if (v === null) return;
      const c = CUSTOMER_ROW_COLUMNS[key];
      if (c) {
        customer[c[0]] = v;
        any = true;
        return;
      }
      const s = slotField(key);
      if (s) {
        slots[s[2] - 1][s[0]] = v;
        slotFilled[s[2] - 1] = true;
        any = true;
      }
    });
    if (!any) continue;
    const mobile = String(customer.mobile ?? '').replace(/\D/g, '');
    if (mobile === EXAMPLE_MOBILE) continue;
    if (!mobile) {
      problems.push({ row: i + 1, message: 'The Mobile number is missing.' });
      continue;
    }
    (data.customers ??= []).push(customer);
    counts.customers++;
    slots.forEach((s, k) => {
      if (!slotFilled[k]) return;
      if (s.service === null || s.service === undefined) {
        problems.push({ row: i + 1, message: `Service ${k + 1}: the other columns of this service are filled, but the Service is empty.` });
        return;
      }
      (data.services ??= []).push({ ...s, mobile: customer.mobile });
      counts.services++;
    });
  }
  return { data, counts, missing: [], ignored, format: 'customer-rows', problems, warnings: [] };
}

export function parseExistingCustomers(wb: Workbook): ParsedImport {
  for (const sheet of wb.sheets) {
    if (/guide|how to|lists|team/i.test(sheet.name)) continue;
    const at = sheet.rows.slice(0, 6).findIndex(r => CUSTOMER_ROW_MARKERS.every(m => (r ?? []).some(c => header(c) === m)));
    if (at >= 0) return parseCustomerRows(sheet, at);
  }
  for (const sheet of wb.sheets) {
    if (/guide|how to|lists|team/i.test(sheet.name)) continue;
    const hdr = sheet.rows.slice(0, 6).findIndex(r => ONE_SHEET_MARKERS.every(m => (r ?? []).some(c => header(c) === m)));
    if (hdr >= 0) return parseOneSheet(sheet, hdr);
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
