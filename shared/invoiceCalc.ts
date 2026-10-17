/**
 * Invoice arithmetic, shared by the browser (live preview), the API and the PDF.
 *
 * Money is held as whole PAISE (integers), never as floating-point rupees, so nothing here can drift by a paisa.
 * The database repeats the same calculation with exact numerics when an invoice is issued (private.invoice_calc),
 * and that stored result is the only one a PDF is drawn from. Both are tested against the same cases.
 *
 * Rules (documented once, here):
 *   GST of a line   = round-half-up( base x rate / 100 ) to the paisa
 *   line total      = base + GST of the line
 *   subtotal        = sum of the bases
 *   total GST       = sum of the ROUNDED line GST amounts (never recomputed from the subtotal)
 *   final amount    = subtotal + total GST
 *   intra-state     = the GST of each rate is split: CGST takes half rounded half-up, SGST the remainder,
 *                     so CGST + SGST always equals the line-level GST exactly
 *   inter-state     = all of the GST is IGST
 */
import type { TaxTreatment } from './gst.js';

export const MAX_AMOUNT_PAISE = 999_999_999_999; // Rs. 9,999,999,999.99
export const MAX_LINES = 50;

export type MoneyInput = string | number | null | undefined;

const DECIMAL = /^\d{1,12}(\.\d{1,2})?$/;

/** Rupees as typed (string or number) to paise, or null when blank, negative, not a number or more than 2 decimals. */
export function toPaise(v: MoneyInput): number | null {
  if (v === null || v === undefined) return null;
  const s = (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v).trim().replace(/,/g, '');
  if (!DECIMAL.test(s)) return null;
  const [r, p = ''] = s.split('.');
  const paise = Number(r) * 100 + Number(p.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

/** A percentage (0 to 100, up to 2 decimals) to hundredths of a percent: 18 -> 1800, 12.5 -> 1250. */
export function toRateBp(v: MoneyInput): number | null {
  if (v === null || v === undefined) return null;
  const s = (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v).trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ''] = s.split('.');
  const bp = Number(r) * 100 + Number(p.padEnd(2, '0'));
  return bp >= 0 && bp <= 10_000 ? bp : null;
}

/** Plain decimal rupees: 1180000 -> "11800.00". */
export const paiseToDecimal = (p: number): string => `${Math.trunc(p / 100)}.${String(Math.abs(p % 100)).padStart(2, '0')}`;

/** Hundredths of a percent as text without noise: 1800 -> "18", 1250 -> "12.5", 925 -> "9.25". */
export const rateText = (bp: number): string => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace(/0$/, ''));

/** GST for a base amount: round-half-up to the paisa, with exact (BigInt) multiplication. */
export function gstPaise(basePaise: number, rateBp: number): number {
  return Number((BigInt(basePaise) * BigInt(rateBp) + 5000n) / 10000n);
}

/** 1234567 paise -> "12,345.67" (Indian grouping: 12,34,567.89). */
export function inr(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = String(Math.trunc(abs / 100));
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${neg ? '-' : ''}${grouped}.${String(abs % 100).padStart(2, '0')}`;
}
/** The "Rs." notation the invoice uses. */
export const rs = (paise: number): string => `Rs.${inr(paise)}`;

// ---------------------------------------------------------------------------
// Rupees in words (Indian system: thousand, lakh, crore)
// ---------------------------------------------------------------------------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.trunc(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.trunc(n / 10)]);
    n %= 10;
  }
  if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

function wholeNumberWords(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.trunc(n / 10_000_000);
  const lakh = Math.trunc((n % 10_000_000) / 100_000);
  const thousand = Math.trunc((n % 100_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** 1888000 paise -> "Eighteen Thousand Eight Hundred Eighty Only/-"; 1888050 -> "... Eighty and Fifty Paise Only/-". */
export function amountInWords(totalPaise: number): string {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0 || totalPaise > MAX_AMOUNT_PAISE) throw new RangeError('Amount out of range.');
  const rupees = Math.trunc(totalPaise / 100);
  const paise = totalPaise % 100;
  if (rupees === 0 && paise > 0) return `${wholeNumberWords(paise)} Paise Only/-`;
  return `${wholeNumberWords(rupees)}${paise ? ` and ${wholeNumberWords(paise)} Paise` : ''} Only/-`;
}

// ---------------------------------------------------------------------------
// The invoice
// ---------------------------------------------------------------------------
export interface CalcLineInput {
  baseAmount: MoneyInput;
  taxRate: MoneyInput;
}
export interface CalcLine {
  basePaise: number;
  rateBp: number;
  gstPaise: number;
  totalPaise: number;
}
/** One tax rate's share of the invoice. */
export interface RateGroup {
  rateBp: number;
  basePaise: number;
  gstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}
export interface InvoiceCalc {
  lines: CalcLine[];
  subtotalPaise: number;
  totalGstPaise: number;
  totalPaise: number;
  groups: RateGroup[];
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** The CGST / SGST rate (half the GST rate, in thousandths of a percent) when every line has the same rate; null when rates differ. */
  cgstRateMilli: number | null;
  sgstRateMilli: number | null;
  igstRateBp: number | null;
  words: string;
}
export interface LineProblem {
  /** 1-based line number, or 0 for a problem with the invoice as a whole. */
  line: number;
  field: 'baseAmount' | 'taxRate' | 'lines';
  message: string;
}
export type CalcResult = ({ ok: true } & InvoiceCalc) | { ok: false; problems: LineProblem[] };

export function calculateInvoice(lines: CalcLineInput[], treatment: TaxTreatment): CalcResult {
  const problems: LineProblem[] = [];
  if (!lines.length) problems.push({ line: 0, field: 'lines', message: 'Add at least one service line.' });
  if (lines.length > MAX_LINES) problems.push({ line: 0, field: 'lines', message: `An invoice can have at most ${MAX_LINES} lines.` });
  const out: CalcLine[] = [];
  lines.forEach((l, i) => {
    const n = i + 1;
    const base = toPaise(l.baseAmount);
    const rate = toRateBp(l.taxRate);
    if (base === null || base <= 0) problems.push({ line: n, field: 'baseAmount', message: `Line ${n}: enter the invoice amount in rupees (more than zero, up to 2 decimals).` });
    else if (base > MAX_AMOUNT_PAISE) problems.push({ line: n, field: 'baseAmount', message: `Line ${n}: the amount is too large.` });
    if (rate === null) problems.push({ line: n, field: 'taxRate', message: `Line ${n}: enter the tax rate as a percentage from 0 to 100 (up to 2 decimals).` });
    if (base !== null && base > 0 && base <= MAX_AMOUNT_PAISE && rate !== null) {
      const g = gstPaise(base, rate);
      out.push({ basePaise: base, rateBp: rate, gstPaise: g, totalPaise: base + g });
    }
  });
  if (problems.length) return { ok: false, problems };

  const subtotal = out.reduce((a, l) => a + l.basePaise, 0);
  const totalGst = out.reduce((a, l) => a + l.gstPaise, 0);
  const total = subtotal + totalGst;
  if (total > MAX_AMOUNT_PAISE) return { ok: false, problems: [{ line: 0, field: 'lines', message: 'The invoice total is too large.' }] };

  const byRate = new Map<number, RateGroup>();
  for (const l of out) {
    const g = byRate.get(l.rateBp) ?? { rateBp: l.rateBp, basePaise: 0, gstPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    g.basePaise += l.basePaise;
    g.gstPaise += l.gstPaise;
    byRate.set(l.rateBp, g);
  }
  const groups = [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp);
  for (const g of groups) {
    if (treatment === 'INTRA_STATE') {
      g.cgstPaise = Math.trunc((g.gstPaise + 1) / 2);
      g.sgstPaise = g.gstPaise - g.cgstPaise;
    } else {
      g.igstPaise = g.gstPaise;
    }
  }
  const cgst = groups.reduce((a, g) => a + g.cgstPaise, 0);
  const sgst = groups.reduce((a, g) => a + g.sgstPaise, 0);
  const igst = groups.reduce((a, g) => a + g.igstPaise, 0);
  const single = groups.length === 1 ? groups[0].rateBp : null;
  return {
    ok: true,
    lines: out,
    subtotalPaise: subtotal,
    totalGstPaise: totalGst,
    totalPaise: total,
    groups,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    cgstRateMilli: treatment === 'INTRA_STATE' && single !== null ? single * 5 : null,
    sgstRateMilli: treatment === 'INTRA_STATE' && single !== null ? single * 5 : null,
    igstRateBp: treatment === 'INTER_STATE' ? single : null,
    words: amountInWords(total)
  };
}

/** A rate in thousandths of a percent as text: 9000 -> "9", 6250 -> "6.25". */
export const rateMilliText = (milli: number): string => String(Number((milli / 1000).toFixed(3)));

/** 2026-06-26 -> 26-06-2026 */
export function invoiceDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
