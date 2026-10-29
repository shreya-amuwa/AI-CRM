import { degrees, PDFDocument, popGraphicsState, pushGraphicsState, rgb, rotateDegrees, StandardFonts, translate, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { INVOICE_GENERATED_PDF_LIMIT_BYTES, type InvoiceStage } from '../../shared/contracts.js';
import { invoiceDate, rateText, rs, toPaise } from '../../shared/invoiceCalc.js';
import { INVOICE_IMAGES, type InvoiceImage } from './assets.js';

/**
 * The invoice PDF, drawn from the stored snapshot ONLY (never from what a browser sends). Text, borders, icons and the
 * PAID stamp are vector; the logos are the few small images of the Amuwa stationery. A4 portrait, a multi-page table that
 * repeats its headings, the stationery header and footer on every page.
 *
 * The same snapshot gives the same bytes (fixed dates, no random ids), so retrying a stage can never produce a second,
 * different file. The PAID stamp is added only when the server renders the PAID stage.
 */

// ---------------------------------------------------------------------------
// Input: the snapshot as the database returns it (see GeneratedInvoice in shared/contracts.ts)
// ---------------------------------------------------------------------------
export interface InvoicePdfInput {
  number: string;
  invoiceDate: string;
  orderNumber: string;
  customer: { name: string; businessName: string | null; address: string; contactPerson: string | null; contactNumber: string | null; gstin: string | null; state: string; stateCode: string };
  taxTreatment: 'INTRA_STATE' | 'INTER_STATE';
  taxOverrideReason?: string | null;
  taxTreatmentOverridden?: boolean;
  reverseCharge: boolean;
  terms: string;
  lines: { position: number; particulars: string; hsnSac: string; taxRate: number; quantity: string; baseAmount: number; gstAmount: number; totalAmount: number }[];
  totals: {
    subtotal: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalGst: number;
    total: number;
    inWords: string;
    breakdown: { rate: number; base: number; gst: number; cgst: number; sgst: number; igst: number }[];
  };
  /** What has been paid and what is left (from the confirmed payments; calculated by the database). Absent: the block is not drawn. */
  paymentSummary?: {
    total: number;
    confirmed: number;
    balance: number;
    state: 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID';
    payments?: { amount: number }[];
    /** The whole agreed order (every invoice of the agreed services together), as worked out by the database. Absent: only the invoice is shown. */
    order?: { totalPayable: number; confirmed: number; balance: number; state: 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID' } | null;
  } | null;
  /** Fixes the PDF's creation date (so the same invoice always gives the same file). */
  issuedAt?: string | null;
}

export interface LayoutBox {
  page: number;
  kind: 'header' | 'footer' | 'title' | 'customer' | 'meta' | 'tableHeading' | 'row' | 'total' | 'bank' | 'state' | 'words' | 'terms' | 'summary' | 'payment' | 'address' | 'signatory' | 'stamp' | 'note';
  x: number;
  /** Top edge, measured down from the top of the page. */
  y: number;
  w: number;
  h: number;
}
export interface InvoicePdfResult {
  bytes: Uint8Array;
  pages: number;
  boxes: LayoutBox[];
}

// ---------------------------------------------------------------------------
// Company details (exactly as supplied)
// ---------------------------------------------------------------------------
export const COMPANY_DETAILS = {
  name: 'Amuwa Corporation',
  tagline: 'We Help The World To Find You',
  accountName: 'Amuwa Corporation',
  bankName: 'Bank of Baroda',
  accountNumber: '51450200000158',
  ifsc: 'BARB0ULWRAI',
  gstNo: '27BDCPK3585J3Z7',
  address: '1107, Shagun Insignia, Above Reliance Trendz, Sec 19 Ulwe, Navi Mumbai, Maharashtra',
  phones: ['+91 9359 734 757', '+91 9987 177 454'],
  email: 'support@amuwa.com',
  websites: ['www.amuwa.com', 'www.aiqr.shop'],
  tollFree: '1800-843-0177',
  salesDepartment: '1107, Shagun Insignia, Sector 19, Above Reliance Trendz, Ulwe Navi Mumbai - Maharashtra India.',
  supportDepartment: '607/608, Shagun Insignia, Sector 19, Above Reliance Trendz, Ulwe Navi Mumbai - Maharashtra India.'
} as const;

// ---------------------------------------------------------------------------
// Geometry (points; y is measured DOWN from the top of the page in this file)
// ---------------------------------------------------------------------------
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MX = 28;
const CW = PAGE_W - 2 * MX;
const HEADER_H = 124;
const FOOTER_H = 122;
const BODY_TOP = HEADER_H + 6;
const BODY_BOTTOM = PAGE_H - FOOTER_H - 6;

const BLUE = rgb(0.25, 0.42, 0.72); // table rules (the stationery's blue)
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.38, 0.38, 0.42);
const NAVY = rgb(0.12, 0.17, 0.4);
const RED = rgb(0.84, 0.18, 0.2);
const WASH = rgb(0.935, 0.985, 0.955);
const HEAD_FILL = rgb(0.9, 0.94, 0.985);
const LINK = rgb(0.06, 0.36, 0.78);
const STAMP_BLUE = rgb(0.1, 0.27, 0.67);

const COLS = [
  { key: 'sr', title: 'Sr. No.', w: 30 },
  { key: 'particulars', title: 'Particulars', w: 168 },
  { key: 'hsn', title: 'HSN/SAC', w: 52 },
  { key: 'rate', title: 'Tax Rate', w: 38 },
  { key: 'qty', title: 'Qty.', w: 50 },
  { key: 'base', title: 'Invoice Amount', w: 66 },
  { key: 'gst', title: 'Taxable Amount', w: 66 },
  { key: 'total', title: 'Total With Tax', w: 69 }
] as const;
const COL_X: number[] = COLS.reduce<number[]>((acc, c, i) => [...acc, i === 0 ? MX : acc[i - 1] + COLS[i - 1].w], []);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
const REPLACE: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', '₹': 'Rs.', '\t': ' ' };

/** Text the standard fonts can draw: typographic characters become plain ones, anything else (e.g. Devanagari) becomes "?". */
export function winAnsi(font: PDFFont, input: string, keepNewlines = false): string {
  const supported = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of (input ?? '').normalize('NFC')) {
    const mapped = REPLACE[ch] ?? ch;
    for (const c of mapped) {
      const cp = c.codePointAt(0)!;
      if (cp === 10 && keepNewlines) {
        out += c;
        continue;
      }
      if (cp < 0x20) continue;
      out += supported.has(cp) ? c : '?';
    }
  }
  return out;
}

class Fonts {
  constructor(
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly serifBold: PDFFont,
    readonly mono: PDFFont,
    readonly monoBold: PDFFont
  ) {}
  clean(f: PDFFont, s: string) {
    return winAnsi(f, s);
  }
  width(f: PDFFont, s: string, size: number) {
    return f.widthOfTextAtSize(winAnsi(f, s), size);
  }
  /** Greedy word wrap that also breaks a word longer than the line. */
  wrap(f: PDFFont, s: string, size: number, maxW: number): string[] {
    const lines: string[] = [];
    for (const para of winAnsi(f, (s ?? '').replace(/\r\n?/g, '\n'), true).split('\n')) {
      let line = '';
      const push = () => {
        lines.push(line);
        line = '';
      };
      for (const word of para.split(/ +/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(candidate, size) <= maxW) {
          line = candidate;
          continue;
        }
        if (line) push();
        if (f.widthOfTextAtSize(word, size) <= maxW) {
          line = word;
          continue;
        }
        let chunk = '';
        for (const ch of word) {
          if (f.widthOfTextAtSize(chunk + ch, size) > maxW && chunk) {
            lines.push(chunk);
            chunk = '';
          }
          chunk += ch;
        }
        line = chunk;
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  }
}

/** Rupees from a JSON number (exact to the paisa for the amounts allowed). */
const paiseOf = (n: number) => toPaise(String(n)) ?? Math.round(n * 100);
const money = (n: number) => rs(paiseOf(n));
const pct = (rate: number) => `${rateText(Math.round(rate * 100))}%`;

// ---------------------------------------------------------------------------
// The painter: top-down coordinates over pdf-lib
// ---------------------------------------------------------------------------
class Painter {
  pages: PDFPage[] = [];
  boxes: LayoutBox[] = [];
  page!: PDFPage;
  images = new Map<string, PDFImage>();

  constructor(
    readonly doc: PDFDocument,
    readonly f: Fonts,
    readonly lean: boolean
  ) {}

  get pageNo() {
    return this.pages.length;
  }

  newPage(): PDFPage {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    return this.page;
  }

  box(kind: LayoutBox['kind'], x: number, y: number, w: number, h: number) {
    this.boxes.push({ page: this.pageNo, kind, x, y, w, h });
  }

  text(s: string, x: number, yBaseline: number, o: { font?: PDFFont; size?: number; color?: RGB; align?: 'left' | 'center' | 'right'; opacity?: number } = {}) {
    const font = o.font ?? this.f.regular;
    const size = o.size ?? 8;
    const clean = this.f.clean(font, s);
    if (!clean) return;
    const w = font.widthOfTextAtSize(clean, size);
    const px = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.page.drawText(clean, { x: px, y: PAGE_H - yBaseline, size, font, color: o.color ?? INK, opacity: o.opacity });
  }

  rect(x: number, y: number, w: number, h: number, o: { fill?: RGB; border?: RGB; bw?: number } = {}) {
    this.page.drawRectangle({ x, y: PAGE_H - y - h, width: w, height: h, color: o.fill, borderColor: o.border, borderWidth: o.border ? o.bw ?? 0.6 : undefined });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = BLUE, w = 0.6) {
    this.page.drawLine({ start: { x: x1, y: PAGE_H - y1 }, end: { x: x2, y: PAGE_H - y2 }, thickness: w, color });
  }

  async image(key: keyof typeof INVOICE_IMAGES, x: number, y: number, w: number, h?: number) {
    const src: InvoiceImage = INVOICE_IMAGES[key];
    let img = this.images.get(key);
    if (!img) {
      // a copy: a small Buffer lives in a shared pool and pdf-lib reads `.buffer` from offset 0
      const bytes = Uint8Array.from(Buffer.from(src.base64, 'base64'));
      img = src.format === 'png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
      this.images.set(key, img);
    }
    const height = h ?? (w * src.height) / src.width;
    this.page.drawImage(img, { x, y: PAGE_H - y - height, width: w, height });
    return height;
  }

  /** Text wrapped in a width; returns the height it took. */
  paragraph(s: string, x: number, yTop: number, maxW: number, o: { font?: PDFFont; size?: number; color?: RGB; leading?: number; align?: 'left' | 'right' | 'center' } = {}): number {
    const font = o.font ?? this.f.regular;
    const size = o.size ?? 8;
    const leading = o.leading ?? size + 2.6;
    const lines = this.f.wrap(font, s, size, maxW);
    lines.forEach((l, i) => this.text(l, o.align === 'right' ? x + maxW : o.align === 'center' ? x + maxW / 2 : x, yTop + size + i * leading, { font, size, color: o.color, align: o.align }));
    return lines.length * leading;
  }
}

// ---------------------------------------------------------------------------
// Stationery: header, footer, watermark
// ---------------------------------------------------------------------------
function drawIcon(p: Painter, kind: 'phone' | 'mail' | 'globe', cx: number, cy: number) {
  const c = rgb(0.1, 0.1, 0.12);
  const page = p.page;
  const Y = (y: number) => PAGE_H - y;
  if (kind === 'phone') {
    p.rect(cx - 5, cy - 8, 10, 16, { border: c, bw: 0.9 });
    p.line(cx - 2, cy + 5, cx + 2, cy + 5, c, 0.9);
    p.line(cx - 2.5, cy - 5.5, cx + 2.5, cy - 5.5, c, 0.5);
  } else if (kind === 'mail') {
    p.rect(cx - 8, cy - 5.5, 16, 11, { border: c, bw: 0.9 });
    p.line(cx - 8, cy - 5.5, cx, cy + 1, c, 0.9);
    p.line(cx + 8, cy - 5.5, cx, cy + 1, c, 0.9);
  } else {
    page.drawCircle({ x: cx, y: Y(cy), size: 8, borderColor: c, borderWidth: 0.9 });
    page.drawEllipse({ x: cx, y: Y(cy), xScale: 3.6, yScale: 8, borderColor: c, borderWidth: 0.7 });
    p.line(cx - 8, cy, cx + 8, cy, c, 0.7);
  }
}

async function drawHeader(p: Painter) {
  const { f } = p;
  p.rect(112, 8, PAGE_W - 112 - 14, 70, { fill: WASH });
  if (!p.lean) await p.image('star', MX - 4, 6, 96);
  else {
    p.text('Amuwa', MX, 44, { font: f.bold, size: 15, color: RED });
    p.text('Corporation', MX + 50, 44, { font: f.bold, size: 15, color: NAVY });
  }
  // the three contact columns
  const cols = [
    { cx: 176, icon: 'phone' as const, lines: [...COMPANY_DETAILS.phones], link: false },
    { cx: 296, icon: 'mail' as const, lines: [COMPANY_DETAILS.email], link: true },
    { cx: 470, icon: 'globe' as const, lines: [...COMPANY_DETAILS.websites], link: true }
  ];
  p.line(232, 22, 232, 70, rgb(0.82, 0.9, 0.85), 0.6);
  p.line(362, 22, 362, 70, rgb(0.82, 0.9, 0.85), 0.6);
  for (const c of cols) {
    drawIcon(p, c.icon, c.cx, 27);
    c.lines.forEach((l, i) => {
      p.text(l, c.cx, 49 + i * 11.5, { size: 8.6, align: 'center', color: c.link ? LINK : INK });
      if (c.link) {
        const w = f.width(f.regular, l, 8.6);
        p.line(c.cx - w / 2, 50.8 + i * 11.5, c.cx + w / 2, 50.8 + i * 11.5, LINK, 0.4);
      }
    });
  }
  if (!p.lean) {
    await p.image('meta', 200, 86, 76);
    await p.image('social', 346, 92, 118);
  } else {
    p.text('Meta Business Partner', 200, 100, { font: f.bold, size: 8.5 });
  }
  p.box('header', 0, 0, PAGE_W, HEADER_H);
}

async function drawFooter(p: Painter, no: number, of: number) {
  const { f } = p;
  const top = PAGE_H - FOOTER_H;
  // the green band starts clear of the logos and of the contact line above it (they used to touch and straddle its top edge)
  const BAND = 54;
  p.rect(0, PAGE_H - BAND, PAGE_W, BAND, { fill: WASH });
  if (!p.lean) {
    await p.image('wabastore', 34, top + 6, 66);
    await p.image('aiqr', 440, top + 1, 34);
    await p.image('croc', 486, top + 7, 38, 38);
  } else {
    p.text('Wabastore | AIQR | CROC DIAL', 34, top + 30, { font: f.bold, size: 9 });
  }
  p.text('Toll Free No: ', 150, top + 36, { size: 11 });
  p.text(COMPANY_DETAILS.tollFree, 152 + f.width(f.regular, 'Toll Free No: ', 11), top + 36, { font: f.bold, size: 11 });
  // contact line (the same details as the header), above the band with room on both sides
  p.text(
    `Contact: ${COMPANY_DETAILS.phones.join(', ')}   |   Email: ${COMPANY_DETAILS.email}   |   ${COMPANY_DETAILS.websites.join('   |   ')}`,
    MX,
    top + 62,
    { size: 6.8, color: MUTED }
  );
  p.text(`Page ${no} of ${of}`, PAGE_W - MX, top + 62, { size: 6.8, color: MUTED, align: 'right' });
  // the two offices, inside the band with a margin of their own
  p.text('Business Sales Department', MX + 6, PAGE_H - 42, { font: f.bold, size: 8 });
  p.paragraph(COMPANY_DETAILS.salesDepartment, MX + 6, PAGE_H - 39, 178, { size: 7, leading: 9 });
  p.text('Customer & Technical Support', 232, PAGE_H - 42, { font: f.monoBold, size: 7.6 });
  p.paragraph(COMPANY_DETAILS.supportDepartment, 232, PAGE_H - 39, 190, { font: f.mono, size: 6.4, leading: 8.4 });
  // made with love in India
  p.text('Made with Love', PAGE_W - 94, PAGE_H - 12, { font: f.bold, size: 7.5, align: 'right' });
  p.page.drawSvgPath('M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z', {
    x: PAGE_W - 91,
    y: 20,
    scale: 0.36,
    color: rgb(0.85, 0.1, 0.15)
  });
  p.text('In India', PAGE_W - 78, PAGE_H - 12, { font: f.bold, size: 7.5 });
  p.box('footer', 0, top, PAGE_W, FOOTER_H);
}

function drawWatermark(p: Painter) {
  if (p.lean) return;
  p.page.drawText('Amuwa Corporation', {
    x: 120,
    y: PAGE_H / 2 - 150,
    size: 50,
    font: p.f.bold,
    color: rgb(0.6, 0.62, 0.68),
    opacity: 0.065,
    rotate: degrees(42)
  });
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------
const PAD = 5;

function moneyCell(p: Painter, s: string, x: number, w: number, yBaseline: number, o: { bold?: boolean; size?: number } = {}) {
  const font = o.bold ? p.f.bold : p.f.regular;
  let size = o.size ?? 8;
  while (size > 6 && p.f.width(font, s, size) > w - 2 * PAD + 2) size -= 0.5;
  p.text(s, x + w - PAD, yBaseline, { font, size, align: 'right' });
}
/** Lines a money value needs in a column (one, or "Rs." above the number when even 6 pt does not fit). */
const moneyLines = (p: Painter, s: string, w: number) => (p.f.width(p.f.regular, s, 6) > w - 2 * PAD + 2 ? 2 : 1);

function drawTableHeading(p: Painter, y: number): number {
  const h = 26;
  p.rect(MX, y, CW, h, { fill: HEAD_FILL, border: BLUE });
  COLS.forEach((c, i) => {
    if (i > 0) p.line(COL_X[i], y, COL_X[i], y + h);
    const lines = p.f.wrap(p.f.bold, c.title, 7.6, c.w - 6);
    const start = y + h / 2 - (lines.length * 9) / 2 + 7;
    lines.forEach((l, k) => p.text(l, COL_X[i] + c.w / 2, start + k * 9, { font: p.f.bold, size: 7.6, align: 'center' }));
  });
  p.box('tableHeading', MX, y, CW, h);
  return h;
}

interface RowLayout {
  lines: string[];
  height: number;
}
function layoutRow(p: Painter, l: InvoicePdfInput['lines'][number]): RowLayout {
  const lines = p.f.wrap(p.f.regular, l.particulars, 8, COLS[1].w - 2 * PAD);
  const qtyLines = p.f.wrap(p.f.regular, l.quantity, 8, COLS[4].w - 6);
  const moneyH = Math.max(moneyLines(p, money(l.baseAmount), COLS[5].w), moneyLines(p, money(l.gstAmount), COLS[6].w), moneyLines(p, money(l.totalAmount), COLS[7].w));
  const textH = Math.max(lines.length * 10.4, qtyLines.length * 10.4, moneyH * 9.5);
  return { lines, height: Math.max(22, textH + 11) };
}

function drawRow(p: Painter, l: InvoicePdfInput['lines'][number], y: number, row: RowLayout) {
  p.rect(MX, y, CW, row.height, { border: BLUE });
  COLS.forEach((c, i) => i > 0 && p.line(COL_X[i], y, COL_X[i], y + row.height));
  const base = y + PAD + 7;
  p.text(String(l.position), COL_X[0] + COLS[0].w / 2, base, { align: 'center' });
  row.lines.forEach((t, i) => p.text(t, COL_X[1] + PAD, base + i * 10.4));
  p.text(l.hsnSac, COL_X[2] + COLS[2].w / 2, base, { align: 'center' });
  p.text(pct(l.taxRate), COL_X[3] + COLS[3].w / 2, base, { align: 'center' });
  p.f.wrap(p.f.regular, l.quantity, 8, COLS[4].w - 6).forEach((t, i) => p.text(t, COL_X[4] + COLS[4].w / 2, base + i * 10.4, { align: 'center' }));
  for (const [idx, v] of [[5, l.baseAmount], [6, l.gstAmount], [7, l.totalAmount]] as const) {
    const s = money(v);
    if (moneyLines(p, s, COLS[idx].w) === 2) {
      p.text('Rs.', COL_X[idx] + COLS[idx].w - PAD, base, { size: 6, align: 'right' });
      p.text(s.slice(3), COL_X[idx] + COLS[idx].w - PAD, base + 8, { size: 6, align: 'right' });
    } else {
      moneyCell(p, s, COL_X[idx], COLS[idx].w, base, { bold: idx === 7 });
    }
  }
  p.box('row', MX, y, CW, row.height);
}

function drawTotalRow(p: Painter, inv: InvoicePdfInput, y: number): number {
  const h = 22;
  p.rect(MX, y, CW, h, { fill: HEAD_FILL, border: BLUE });
  [5, 6, 7].forEach(i => p.line(COL_X[i], y, COL_X[i], y + h));
  p.text('Total:', COL_X[5] - PAD, y + 14.5, { font: p.f.bold, size: 9, align: 'right' });
  const base = inv.totals.subtotal;
  moneyCell(p, money(base), COL_X[5], COLS[5].w, y + 14.5, { bold: true, size: 8 });
  moneyCell(p, money(inv.totals.totalGst), COL_X[6], COLS[6].w, y + 14.5, { bold: true, size: 8 });
  moneyCell(p, money(inv.totals.total), COL_X[7], COLS[7].w, y + 14.5, { bold: true, size: 8 });
  p.box('total', MX, y, CW, h);
  return h;
}

/** The customer / invoice grid under the title. Returns its height. */
function drawInfoGrid(p: Painter, inv: InvoicePdfInput, y: number): number {
  const { f } = p;
  const LW = 316;
  const RW = CW - LW;
  const c = inv.customer;
  const name = c.businessName || c.name;
  const show = (s: string | null | undefined) => (s && s.trim() ? s : '-');

  // left: customer information
  const nameLines = f.wrap(f.regular, name, 8.6, LW - 46);
  const addrLines = f.wrap(f.regular, c.address, 8.2, LW - 46);
  const nameH = Math.max(20, nameLines.length * 11 + 9);
  const addrH = Math.max(32, addrLines.length * 10.4 + 9);
  const stateH = 20;
  const leftH = nameH + addrH + stateH;

  // right: invoice information
  const rows: [string, string][] = [
    ['INVOICE No.', inv.number],
    ['DATE', invoiceDate(inv.invoiceDate)],
    ['GST No.', show(c.gstin)],
    ['Contact person', show(c.contactPerson)],
    ['Contact number', show(c.contactNumber)],
    ['Order No.', show(inv.orderNumber)]
  ];
  const LAB = 82;
  const rowLines = rows.map(([, v]) => f.wrap(f.bold, v, 8.4, RW - LAB - 8));
  const rowH = rowLines.map(l => Math.max(20, l.length * 10.6 + 8));
  const rightH = rowH.reduce((a, b) => a + b, 0);
  const H = Math.max(leftH, rightH);

  // left box (the address row stretches so both blocks end together)
  const addrFull = addrH + (H - leftH);
  p.rect(MX, y, LW, H, { border: BLUE });
  let cy = y;
  p.line(MX, cy + nameH, MX + LW, cy + nameH);
  p.text('Name:', MX + 6, cy + 13.2, { font: f.bold, size: 8.6 });
  nameLines.forEach((l, i) => p.text(l, MX + 44, cy + 13.2 + i * 11, { size: 8.6 }));
  cy += nameH;
  p.line(MX, cy + addrFull, MX + LW, cy + addrFull);
  p.text('Add:', MX + 6, cy + 12.4, { font: f.bold, size: 8.2 });
  addrLines.forEach((l, i) => p.text(l, MX + 44, cy + 12.4 + i * 10.4, { size: 8.2 }));
  cy += addrFull;
  p.line(MX + LW / 2, cy, MX + LW / 2, y + H);
  p.text('State:', MX + 6, cy + 13.2, { font: f.bold, size: 8.4 });
  p.text(c.state.toUpperCase(), MX + 38, cy + 13.2, { size: 8.4 });
  p.text('State Code:', MX + LW / 2 + 6, cy + 13.2, { font: f.bold, size: 8.4 });
  p.text(c.stateCode, MX + LW / 2 + 62, cy + 13.2, { size: 8.4 });
  p.box('customer', MX, y, LW, H);

  // right box
  const rx = MX + LW;
  p.rect(rx, y, RW, H, { border: BLUE });
  let ry = y;
  rows.forEach(([label], i) => {
    const h = i === rows.length - 1 ? H - (ry - y) : rowH[i];
    if (i > 0) p.line(rx, ry, rx + RW, ry);
    p.text(label, rx + 6, ry + 13.2, { font: f.bold, size: 8.4 });
    rowLines[i].forEach((l, k) => p.text(l, rx + LAB, ry + 13.2 + k * 10.6, { font: f.bold, size: 8.4 }));
    ry += h;
  });
  p.line(rx + LAB - 4, y, rx + LAB - 4, y + H, rgb(0.8, 0.86, 0.95), 0.4);
  p.box('meta', rx, y, RW, H);
  return H;
}

interface Block {
  h: number;
  draw: (y: number, h: number) => void;
}

/** The lower part: bank details, state, words, terms (left); tax summary, address, signatory + stamp (right). */
function layoutBottom(p: Painter, inv: InvoicePdfInput, stage: InvoiceStage): { left: Block[]; right: Block[]; height: number } {
  const { f } = p;
  const LW = 262;
  const RW = CW - LW;
  const RX = MX + LW;
  const labelW = 118;
  const rateW = 52;

  // ---- left
  const bank: Block = {
    h: 80,
    draw: (y, h) => {
      p.rect(MX, y, LW, h, { border: BLUE });
      const rows: [string, string][] = [
        ['Ac Name:', COMPANY_DETAILS.accountName],
        ['Bank Name:', COMPANY_DETAILS.bankName],
        ['Account Number:', COMPANY_DETAILS.accountNumber],
        ['IFSC Code:', COMPANY_DETAILS.ifsc],
        ['GST No:', COMPANY_DETAILS.gstNo]
      ];
      rows.forEach(([k, v], i) => {
        p.text(k, MX + 7, y + 14 + i * 13.4, { font: f.bold, size: 8.4 });
        p.text(v, MX + 92, y + 14 + i * 13.4, { font: f.bold, size: 8.4 });
      });
      p.box('bank', MX, y, LW, h);
    }
  };
  const supplyText = inv.taxTreatment === 'INTRA_STATE' ? 'Intra-state supply: CGST + SGST' : 'Inter-state supply: IGST';
  const stateLines = f.wrap(f.regular, `${supplyText}${inv.taxTreatmentOverridden ? ' (set by Accounts)' : ''}`, 7.6, LW - 14);
  const state: Block = {
    h: 24 + stateLines.length * 9.6,
    draw: (y, h) => {
      p.rect(MX, y, LW, h, { border: BLUE });
      p.text('State:', MX + 7, y + 13.5, { font: f.bold, size: 8.4 });
      p.text(inv.customer.state.toUpperCase(), MX + 38, y + 13.5, { size: 8.4 });
      p.text('State Code:', MX + 138, y + 13.5, { font: f.bold, size: 8.4 });
      p.text(inv.customer.stateCode, MX + 194, y + 13.5, { size: 8.4 });
      stateLines.forEach((l, i) => p.text(l, MX + 7, y + 25 + i * 9.6, { size: 7.6, color: MUTED }));
      p.box('state', MX, y, LW, h);
    }
  };
  const wordLines = f.wrap(f.bold, inv.totals.inWords, 8.6, LW - 14);
  const words: Block = {
    h: 16 + wordLines.length * 11,
    draw: (y, h) => {
      p.rect(MX, y, LW, h, { border: BLUE });
      p.text('Amount in Words:', MX + 7, y + 11, { size: 7.2, color: MUTED });
      wordLines.forEach((l, i) => p.text(l, MX + 7, y + 22.5 + i * 11, { font: f.bold, size: 8.6 }));
      p.box('words', MX, y, LW, h);
    }
  };
  // Payment status: what the invoice came to, what was confirmed, what is left. On the paid invoice it is settled by definition.
  const ps = inv.paymentSummary;
  const settled = stage === 'PAID';
  const statusText = (state: 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID') => (state === 'FULLY_PAID' ? 'Fully Paid' : state === 'PARTIALLY_PAID' ? 'Partially Paid' : 'Unpaid');
  const order = ps?.order ?? null;
  // Each row: label, value, and how it is drawn. With an order: this invoice (total, the confirmed money applied to it, its own balance), then
  // the whole order (payable including GST, confirmed payments, outstanding): the two balances are different things and both are shown.
  type PayRow = { k: string; v: string; bold?: boolean; fill?: boolean; gap?: boolean };
  const payRows: PayRow[] = !ps
    ? []
    : order
      ? [
          { k: 'Current Invoice Total:', v: money(ps.total), bold: true },
          { k: 'Payments Applied to This Invoice:', v: money(ps.confirmed) },
          { k: 'Invoice Balance:', v: money(Math.max(ps.balance, 0)), bold: true },
          { k: 'Order Total Payable (incl. GST):', v: money(order.totalPayable), gap: true },
          { k: 'Total Confirmed Payments:', v: money(order.confirmed) },
          { k: 'Total Order Balance Outstanding:', v: money(Math.max(order.balance, 0)), bold: true, fill: true },
          { k: 'Payment Status:', v: statusText(order.state), bold: true }
        ]
      : [
          { k: 'Invoice Total:', v: money(ps.total) },
          { k: 'Payments Received:', v: money(settled ? ps.total : ps.confirmed) },
          ...(settled && ps.payments && ps.payments.length ? [{ k: 'This Payment:', v: money(ps.payments[ps.payments.length - 1].amount) }] : []),
          { k: 'Balance Outstanding:', v: money(settled ? 0 : Math.max(ps.balance, 0)), bold: true },
          { k: 'Payment Status:', v: settled || ps.state === 'FULLY_PAID' ? 'Fully Paid' : statusText(ps.state), bold: true }
        ];
  // every row has its own height with the text centred in it, and the block has a margin top and bottom: nothing touches a rule
  const PAY_ROW = order ? 15.5 : 15.5;
  const PAY_PAD = 5;
  const payGap = payRows.filter(r => r.gap).length * 6;
  const payment: Block = {
    h: ps ? 2 * PAY_PAD + payRows.length * PAY_ROW + payGap : 0,
    draw: (y, h) => {
      p.rect(MX, y, LW, h, { border: BLUE });
      let ry = y + PAY_PAD;
      payRows.forEach(r => {
        if (r.gap) {
          p.line(MX, ry + 3, MX + LW, ry + 3);
          ry += 6;
        }
        if (r.fill) p.rect(MX, ry, LW, PAY_ROW, { fill: HEAD_FILL, border: BLUE });
        const size = r.fill ? 8.8 : 8.4;
        const base = ry + PAY_ROW / 2 + size * 0.36;
        p.text(r.k, MX + 7, base, { font: f.bold, size });
        p.text(r.v, MX + LW - 8, base, { font: r.bold ? f.bold : f.regular, size: r.fill ? 9.2 : 8.4, align: 'right' });
        ry += PAY_ROW;
      });
      p.box('payment', MX, y, LW, h);
    }
  };
  const termLines = f.wrap(f.regular, inv.terms || '', 8, LW - 14);
  const terms: Block = {
    h: 30 + Math.max(1, termLines.length) * 10.4,
    draw: (y, h) => {
      p.rect(MX, y, LW, h, { border: BLUE });
      p.text('Terms & Conditions', MX + 7, y + 13, { font: f.bold, size: 8.6 });
      termLines.forEach((l, i) => p.text(l, MX + 7, y + 26 + i * 10.4, { size: 8 }));
      p.box('terms', MX, y, LW, h);
    }
  };
  const left = ps ? [bank, state, words, payment, terms] : [bank, state, words, terms];

  // ---- right: the tax summary (only the components that apply; one row per rate when rates differ)
  type SumRow = { label: string; rate?: string; amount: string; bold?: boolean; fill?: RGB };
  const multi = inv.totals.breakdown.length > 1;
  const sum: SumRow[] = [{ label: 'Total Amount Before Tax', amount: money(inv.totals.subtotal), bold: true }];
  for (const g of inv.totals.breakdown) {
    const tag = multi ? ` @ ${pct(g.rate)}` : '';
    if (inv.taxTreatment === 'INTRA_STATE') {
      sum.push({ label: `Add: CGST${tag}`, rate: pct(g.rate / 2), amount: money(g.cgst) });
      sum.push({ label: `Add: SGST${tag}`, rate: pct(g.rate / 2), amount: money(g.sgst) });
    } else {
      sum.push({ label: `Add: IGST${tag}`, rate: pct(g.rate), amount: money(g.igst) });
    }
  }
  sum.push({ label: 'Tax Amount GST', amount: money(inv.totals.totalGst), bold: true });
  sum.push({ label: 'Final Amount After Tax', amount: money(inv.totals.total), bold: true, fill: HEAD_FILL });
  sum.push({ label: 'GST Payable on Reverse Charge', amount: inv.reverseCharge ? money(inv.totals.totalGst) : 'Nil' });
  const SUM_ROW = 17;
  const summary: Block = {
    h: 19 + sum.length * SUM_ROW,
    draw: (y, h) => {
      p.rect(RX, y, RW, h, { border: BLUE });
      p.rect(RX, y, RW, 19, { fill: HEAD_FILL, border: BLUE });
      p.text('Particulars', RX + 6, y + 12.6, { font: f.bold, size: 8 });
      p.text('Rate', RX + labelW + rateW / 2 + 22, y + 12.6, { font: f.bold, size: 8, align: 'center' });
      p.text('Amount', RX + RW - 8, y + 12.6, { font: f.bold, size: 8, align: 'right' });
      p.line(RX + labelW + 22, y, RX + labelW + 22, y + h);
      p.line(RX + labelW + 22 + rateW, y, RX + labelW + 22 + rateW, y + h);
      sum.forEach((r, i) => {
        const ry = y + 19 + i * SUM_ROW;
        if (r.fill) p.rect(RX, ry, RW, SUM_ROW, { fill: r.fill, border: BLUE });
        else p.line(RX, ry, RX + RW, ry);
        const font = r.bold ? f.bold : f.regular;
        let size = 7.9;
        while (size > 6.2 && f.width(font, r.label, size) > labelW + 16) size -= 0.3;
        p.text(r.label, RX + 6, ry + 11.8, { font, size });
        if (r.rate) p.text(r.rate, RX + labelW + 22 + rateW / 2, ry + 11.8, { size: 7.9, align: 'center' });
        let aSize = 8;
        while (aSize > 6 && f.width(font, r.amount, aSize) > RW - labelW - rateW - 36) aSize -= 0.5;
        p.text(r.amount, RX + RW - 8, ry + 11.8, { font, size: aSize, align: 'right' });
      });
      p.box('summary', RX, y, RW, h);
    }
  };
  const addrLines = f.wrap(f.bold, COMPANY_DETAILS.address, 8, RW - 14);
  const address: Block = {
    h: 24 + addrLines.length * 10.2,
    draw: (y, h) => {
      p.rect(RX, y, RW, h, { border: BLUE });
      p.text('Company Address:', RX + 7, y + 12.5, { font: f.bold, size: 8.4 });
      addrLines.forEach((l, i) => p.text(l, RX + 7, y + 24.5 + i * 10.2, { font: f.bold, size: 8 }));
      p.box('address', RX, y, RW, h);
    }
  };
  // the signatory area: blank on the unpaid invoice; the PAID stamp goes here on the paid invoice, nowhere else
  const signatory: Block = {
    h: 104,
    draw: (y, h) => {
      p.rect(RX, y, RW, h, { border: BLUE });
      p.text(`For ${COMPANY_DETAILS.name}`, RX + RW - 10, y + 13, { font: f.bold, size: 8.4, align: 'right' });
      p.text('Authorised Signatory', RX + RW - 10, y + h - 8, { size: 7.6, align: 'right', color: MUTED });
      p.box('signatory', RX, y, RW, h);
      if (stage === 'PAID') drawPaidStamp(p, RX + RW / 2 + 4, y + h / 2 + 3);
    }
  };
  const right = [summary, address, signatory];
  const sumOf = (bs: Block[]) => bs.reduce((a, b) => a + b.h, 0);
  return { left, right, height: Math.max(sumOf(left), sumOf(right)) };
}

/** The PAID stamp: a blue, double-bordered rectangle, tilted, in the signatory area. Only the PAID stage draws it. */
function drawPaidStamp(p: Painter, cx: number, cy: number) {
  const w = 104;
  const h = 42;
  p.page.pushOperators(pushGraphicsState(), translate(cx, PAGE_H - cy), rotateDegrees(13));
  p.page.drawRectangle({ x: -w / 2, y: -h / 2, width: w, height: h, borderColor: STAMP_BLUE, borderWidth: 2.4, borderOpacity: 0.92 });
  p.page.drawRectangle({ x: -w / 2 + 4.5, y: -h / 2 + 4.5, width: w - 9, height: h - 9, borderColor: STAMP_BLUE, borderWidth: 0.9, borderOpacity: 0.92 });
  const size = 25;
  const tw = p.f.bold.widthOfTextAtSize('PAID', size);
  p.page.drawText('PAID', { x: -tw / 2, y: -size * 0.36, size, font: p.f.bold, color: STAMP_BLUE, opacity: 0.92 });
  p.page.pushOperators(popGraphicsState());
  p.box('stamp', cx - w / 2, cy - h / 2, w, h);
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------
async function build(inv: InvoicePdfInput, stage: InvoiceStage, lean: boolean): Promise<InvoicePdfResult> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts = new Fonts(
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    await doc.embedFont(StandardFonts.TimesRomanBold),
    await doc.embedFont(StandardFonts.Courier),
    await doc.embedFont(StandardFonts.CourierBold)
  );
  const at = new Date(inv.issuedAt || `${inv.invoiceDate}T00:00:00Z`);
  doc.setTitle(`Invoice ${inv.number}${stage === 'PAID' ? ' (Paid)' : ''}`);
  doc.setAuthor(COMPANY_DETAILS.name);
  doc.setSubject(`Tax invoice ${inv.number}`);
  doc.setKeywords(['invoice', inv.number]);
  doc.setCreator('Amuwa CRM');
  doc.setProducer('Amuwa CRM (pdf-lib)');
  doc.setCreationDate(at);
  doc.setModificationDate(at);

  const p = new Painter(doc, fonts, lean);
  const start = async (continued: boolean) => {
    p.newPage();
    drawWatermark(p);
    await drawHeader(p);
    if (continued) {
      p.text(`Invoice ${inv.number} (continued)`, PAGE_W / 2, BODY_TOP + 20, { font: fonts.serifBold, size: 14, align: 'center' });
      p.box('title', MX, BODY_TOP + 6, CW, 20);
      return BODY_TOP + 34;
    }
    p.text('Invoice', PAGE_W / 2, BODY_TOP + 24, { font: fonts.serifBold, size: 22, align: 'center' });
    p.box('title', MX, BODY_TOP + 4, CW, 28);
    const gridTop = BODY_TOP + 38;
    const gh = drawInfoGrid(p, inv, gridTop);
    return gridTop + gh + 9;
  };

  let y = await start(false);
  y += drawTableHeading(p, y);
  for (const line of inv.lines) {
    const row = layoutRow(p, line);
    if (y + row.height > BODY_BOTTOM) {
      y = await start(true);
      y += drawTableHeading(p, y);
    }
    drawRow(p, line, y, row);
    y += row.height;
  }
  // the total row stays with the table; if it does not fit, it moves to a new page together with the heading
  if (y + 22 > BODY_BOTTOM) {
    y = await start(true);
    y += drawTableHeading(p, y);
  }
  y += drawTotalRow(p, inv, y);

  const bottom = layoutBottom(p, inv, stage);
  if (y + 6 + bottom.height > BODY_BOTTOM) y = await start(true);
  else y += 6;
  // two columns; both end together (the last block of the shorter column stretches)
  const place = (blocks: Block[], extra: number) => {
    let yy = y;
    blocks.forEach((b, i) => {
      const h = i === blocks.length - 1 ? b.h + extra : b.h;
      b.draw(yy, h);
      yy += h;
    });
  };
  const sumL = bottom.left.reduce((a, b) => a + b.h, 0);
  const sumR = bottom.right.reduce((a, b) => a + b.h, 0);
  place(bottom.left, bottom.height - sumL);
  place(bottom.right, bottom.height - sumR);

  // footers last, when the number of pages is known
  const total = p.pages.length;
  for (let i = 0; i < total; i++) {
    p.page = p.pages[i];
    const before = p.boxes.length;
    await drawFooter(p, i + 1, total);
    for (let k = before; k < p.boxes.length; k++) p.boxes[k].page = i + 1;
  }
  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false });
  return { bytes, pages: total, boxes: p.boxes };
}

/**
 * Renders the unpaid or the paid invoice. The result is checked against the size limit (strictly below 500,000 bytes):
 * if the first rendering is too big, a lean one (no watermark, no pictures) is tried; if that is still too big this
 * throws rather than return a file that must not be stored or sent.
 */
export async function renderInvoicePdf(inv: InvoicePdfInput, opts: { stage: InvoiceStage; /** For tests: a smaller limit than the real one. */ limitBytes?: number }): Promise<InvoicePdfResult> {
  const limit = opts.limitBytes ?? INVOICE_GENERATED_PDF_LIMIT_BYTES;
  let out = await build(inv, opts.stage, false);
  if (out.bytes.length >= limit) out = await build(inv, opts.stage, true);
  if (out.bytes.length >= limit) throw new Error(`The invoice PDF is ${out.bytes.length} bytes, which is over the ${limit - 1} byte limit even without pictures.`);
  return out;
}
