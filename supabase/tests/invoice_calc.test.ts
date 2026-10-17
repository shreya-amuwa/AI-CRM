/**
 * Invoice arithmetic, amount in words, GST state helpers (no database needed).
 * Run: npm run test:unit
 */
import {
  amountInWords,
  calculateInvoice,
  gstPaise,
  inr,
  invoiceDate,
  paiseToDecimal,
  rateMilliText,
  rateText,
  rs,
  toPaise,
  toRateBp
} from '../../shared/invoiceCalc.js';
import {
  COMPANY_STATE_CODE,
  defaultTaxTreatment,
  GST_STATES,
  gstinStateCode,
  inferStateFromAddress,
  isValidGstinFormat,
  reviewCustomerTax
} from '../../shared/gst.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}
const ok = (r: ReturnType<typeof calculateInvoice>) => {
  if (!r.ok) throw new Error(`expected a result, got: ${JSON.stringify(r.problems)}`);
  return r;
};

// ---------------------------------------------------------------------------
console.log('--- 1. Money parsing');
check(toPaise('10000') === 1_000_000 && toPaise(10000) === 1_000_000, 'rupees to paise');
check(toPaise('1,80,000.50') === 18_000_050, 'commas are accepted');
check(toPaise('0.1') === 10 && toPaise('0.05') === 5 && toPaise(19.99) === 1999, 'decimals are exact (no floating-point drift)');
for (const bad of ['', '  ', null, undefined, '-5', '-0.01', 'abc', '1.234', '1e3', 'NaN', '12.', '.5', Number.NaN, Infinity]) {
  check(toPaise(bad as never) === null, `invalid amount refused: ${String(bad)}`);
}
check(toRateBp('18') === 1800 && toRateBp(12.5) === 1250 && toRateBp('0') === 0 && toRateBp('100') === 10_000, 'tax rate to hundredths of a percent');
for (const bad of ['', null, '-1', '100.01', '101', 'x', '1.234']) check(toRateBp(bad as never) === null, `invalid tax rate refused: ${String(bad)}`);
check(inr(1_880_000) === '18,800.00' && inr(123_456_789) === '12,34,567.89' && inr(5) === '0.05' && inr(100_000_000_00) === '10,00,00,000.00', 'Indian digit grouping');
check(rs(1_000_000) === 'Rs.10,000.00', 'the Rs. notation');
check(paiseToDecimal(1_180_000) === '11800.00' && paiseToDecimal(5) === '0.05', 'decimal string for the database');
check(rateText(1800) === '18' && rateText(1250) === '12.5' && rateText(925) === '9.25' && rateMilliText(9000) === '9' && rateMilliText(6250) === '6.25', 'rate text');
check(invoiceDate('2026-06-26') === '26-06-2026' && invoiceDate(null) === '', 'invoice date is DD-MM-YYYY');

// ---------------------------------------------------------------------------
console.log('--- 2. The reference numbers (and the mistake in the sample)');
{
  const r = ok(calculateInvoice([{ baseAmount: 10000, taxRate: 18 }, { baseAmount: 6000, taxRate: 18 }], 'INTRA_STATE'));
  check(r.lines[0].gstPaise === 180_000 && r.lines[0].totalPaise === 1_180_000, 'line 1: Rs.10,000 + 18% GST Rs.1,800 = Rs.11,800');
  check(r.lines[1].gstPaise === 108_000 && r.lines[1].totalPaise === 708_000, 'line 2: Rs.6,000 + 18% GST Rs.1,080 = Rs.7,080');
  check(r.subtotalPaise === 1_600_000 && r.totalGstPaise === 288_000 && r.totalPaise === 1_888_000, 'subtotal Rs.16,000, GST Rs.2,880, final Rs.18,880');
  check(r.words === 'Eighteen Thousand Eight Hundred Eighty Only/-', 'amount in words', r.words);
  check(r.lines[0].totalPaise !== 1_100_000, 'the sample\'s wrong Rs.11,000 row total can never be produced');
  check(r.lines.every(l => l.totalPaise === l.basePaise + l.gstPaise), 'every line total is base + GST');
  check(r.lines.reduce((a, l) => a + l.totalPaise, 0) === r.totalPaise, 'the lines add up to the final amount');
  check(r.cgstPaise === 144_000 && r.sgstPaise === 144_000 && r.igstPaise === 0, 'intra-state: CGST Rs.1,440 + SGST Rs.1,440');
  check(r.cgstRateMilli === 9000 && r.sgstRateMilli === 9000 && r.igstRateBp === null, 'intra-state at 18%: 9% CGST and 9% SGST');
  // The sample showed the GST column (Rs.1800) as if it were the base. Treating it as the base must give a different (wrong) answer.
  const wrong = ok(calculateInvoice([{ baseAmount: 1800, taxRate: 18 }], 'INTRA_STATE'));
  check(wrong.totalPaise !== 1_180_000, 'the GST amount is never mistaken for the base amount');
}
{
  const r = ok(calculateInvoice([{ baseAmount: 10000, taxRate: 18 }, { baseAmount: 6000, taxRate: 18 }], 'INTER_STATE'));
  check(r.igstPaise === 288_000 && r.cgstPaise === 0 && r.sgstPaise === 0, 'inter-state: all Rs.2,880 is IGST');
  check(r.igstRateBp === 1800 && r.cgstRateMilli === null, 'inter-state at 18%: 18% IGST');
  check(r.totalPaise === 1_888_000, 'the final amount does not depend on the tax treatment');
}

// ---------------------------------------------------------------------------
console.log('--- 3. Five or more service rows');
{
  const rows = [
    { baseAmount: '10000', taxRate: '18' },
    { baseAmount: '6000', taxRate: '18' },
    { baseAmount: '2499.99', taxRate: '18' },
    { baseAmount: '15000.50', taxRate: '12' },
    { baseAmount: '999', taxRate: '5' },
    { baseAmount: '1', taxRate: '0' }
  ];
  const r = ok(calculateInvoice(rows, 'INTRA_STATE'));
  const gst = [180_000, 108_000, 45_000, 180_006, 4_995, 0];
  check(r.lines.map(l => l.gstPaise).join() === gst.join(), 'each row GST (round-half-up per row)', r.lines.map(l => l.gstPaise));
  check(r.subtotalPaise === 1_000_000 + 600_000 + 249_999 + 1_500_050 + 99_900 + 100, 'subtotal is the sum of the bases');
  check(r.totalGstPaise === gst.reduce((a, b) => a + b, 0), 'total GST is the sum of the rounded row GST amounts');
  check(r.totalPaise === r.subtotalPaise + r.totalGstPaise, 'final = subtotal + GST');
  check(r.groups.length === 4 && r.groups.map(g => g.rateBp).join() === '0,500,1200,1800', 'one tax group per distinct rate, ordered');
  check(r.cgstRateMilli === null && r.sgstRateMilli === null && r.igstRateBp === null, 'different rates: no misleading single rate is reported');
  check(r.cgstPaise + r.sgstPaise === r.totalGstPaise, 'CGST + SGST equals the total GST');
  for (const g of r.groups) check(g.cgstPaise + g.sgstPaise === g.gstPaise, `rate ${g.rateBp / 100}%: CGST + SGST = GST`);
  const inter = ok(calculateInvoice(rows, 'INTER_STATE'));
  check(inter.igstPaise === r.totalGstPaise && inter.cgstPaise === 0, 'inter-state: IGST is the total GST');
}

// ---------------------------------------------------------------------------
console.log('--- 4. Rounding');
check(gstPaise(1, 1800) === 0, '1 paisa at 18% is 0.18 paisa: rounds to 0');
check(gstPaise(5, 1800) === 1, '5 paise at 18% is 0.9 paisa: rounds to 1');
check(gstPaise(10_025, 1800) === 1805, 'Rs.100.25 at 18% = 18.045: rounds half up to 18.05');
check(gstPaise(3333, 1800) === 600, 'Rs.33.33 at 18% = 5.9994: rounds to 6.00');
check(gstPaise(999_999_999_999, 10_000) === 999_999_999_999, 'no overflow at the largest amount');
{
  const r = ok(calculateInvoice([{ baseAmount: '100.25', taxRate: '18' }], 'INTRA_STATE'));
  check(r.totalGstPaise === 1805 && r.cgstPaise === 903 && r.sgstPaise === 902, 'an odd paisa goes to CGST (9.03 + 9.02 = 18.05)');
  check(r.cgstPaise + r.sgstPaise === r.totalGstPaise, 'the split never loses or gains a paisa');
  // Many small lines: the total is the sum of ROUNDED lines, not the rounding of the sum
  const many = ok(calculateInvoice(Array.from({ length: 10 }, () => ({ baseAmount: '0.05', taxRate: '18' })), 'INTRA_STATE'));
  check(many.totalGstPaise === 10, '10 lines of Rs.0.05 each carry Rs.0.01: the total GST is the sum of the rounded lines');
}

// ---------------------------------------------------------------------------
console.log('--- 5. Zero, blank, negative and invalid values');
for (const [label, rows] of [
  ['zero amount', [{ baseAmount: 0, taxRate: 18 }]],
  ['blank amount', [{ baseAmount: '', taxRate: 18 }]],
  ['missing amount', [{ baseAmount: null, taxRate: 18 }]],
  ['negative amount', [{ baseAmount: -100, taxRate: 18 }]],
  ['three decimals', [{ baseAmount: '10.005', taxRate: 18 }]],
  ['text amount', [{ baseAmount: 'ten', taxRate: 18 }]],
  ['blank tax rate', [{ baseAmount: 100, taxRate: '' }]],
  ['negative tax rate', [{ baseAmount: 100, taxRate: -5 }]],
  ['tax above 100', [{ baseAmount: 100, taxRate: 101 }]],
  ['no lines', []],
  ['one bad line among good ones', [{ baseAmount: 100, taxRate: 18 }, { baseAmount: 0, taxRate: 18 }]],
  ['amount too large', [{ baseAmount: '10000000000', taxRate: 18 }]],
  ['total too large', [{ baseAmount: '9999999999.99', taxRate: 18 }]],
  ['too many lines', Array.from({ length: 51 }, () => ({ baseAmount: 1, taxRate: 18 }))]
] as const) {
  const r = calculateInvoice(rows as never, 'INTRA_STATE');
  check(!r.ok && r.problems.length > 0, `refused: ${label}`);
}
{
  const r = calculateInvoice([{ baseAmount: 100, taxRate: 18 }, { baseAmount: 0, taxRate: 18 }], 'INTRA_STATE');
  check(!r.ok && r.problems[0].line === 2 && r.problems[0].field === 'baseAmount', 'the problem names the line and field');
}

// ---------------------------------------------------------------------------
console.log('--- 6. Rupees in words (thousands, lakhs, crores, paise)');
const W = (rupees: number, paise = 0) => amountInWords(rupees * 100 + paise);
check(W(18_880) === 'Eighteen Thousand Eight Hundred Eighty Only/-', '18,880');
check(W(1) === 'One Only/-' && W(10) === 'Ten Only/-' && W(19) === 'Nineteen Only/-' && W(20) === 'Twenty Only/-' && W(99) === 'Ninety Nine Only/-', 'small numbers');
check(W(100) === 'One Hundred Only/-' && W(101) === 'One Hundred One Only/-' && W(999) === 'Nine Hundred Ninety Nine Only/-', 'hundreds');
check(W(1000) === 'One Thousand Only/-' && W(11_000) === 'Eleven Thousand Only/-' && W(99_999) === 'Ninety Nine Thousand Nine Hundred Ninety Nine Only/-', 'thousands');
check(W(100_000) === 'One Lakh Only/-' && W(1_234_567) === 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only/-' && W(9_900_000) === 'Ninety Nine Lakh Only/-', 'lakhs');
check(W(10_000_000) === 'One Crore Only/-' && W(123_456_789) === 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only/-', 'crores');
check(W(1_000_000_000) === 'One Hundred Crore Only/-' && W(9_999_999_999) === 'Nine Hundred Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Only/-', 'the largest amount');
check(W(18_880, 50) === 'Eighteen Thousand Eight Hundred Eighty and Fifty Paise Only/-', 'with paise');
check(W(1, 1) === 'One and One Paise Only/-' && W(0, 50) === 'Fifty Paise Only/-' && W(0, 5) === 'Five Paise Only/-', 'paise only / one paisa');
check(W(2_00_000, 99) === 'Two Lakh and Ninety Nine Paise Only/-', 'lakh with paise');
check(amountInWords(0) === 'Zero Only/-', 'zero');
for (const bad of [-1, 1.5, 1_000_000_000_000, Number.NaN]) {
  let threw = false;
  try { amountInWords(bad); } catch { threw = true; }
  check(threw, `words refuse an invalid amount: ${bad}`);
}

// ---------------------------------------------------------------------------
console.log('--- 7. Tax treatment, states and GSTIN');
check(COMPANY_STATE_CODE === '27', 'the company is registered in Maharashtra (27)');
check(defaultTaxTreatment('27') === 'INTRA_STATE', 'customer in Maharashtra: CGST + SGST');
check(defaultTaxTreatment('24') === 'INTER_STATE' && defaultTaxTreatment('29') === 'INTER_STATE', 'customer elsewhere: IGST');
check(defaultTaxTreatment(null) === null && defaultTaxTreatment('') === null && defaultTaxTreatment('99') === null, 'unknown state: unresolved, Accounts must decide');
check(new Set(GST_STATES.map(s => s.code)).size === GST_STATES.length && GST_STATES.every(s => /^\d{2}$/.test(s.code)), 'state codes are unique two-digit codes');
check(inferStateFromAddress('1107, Shagun Insignia, Above Reliance Trendz, Sec 19 Ulwe, Navi Mumbai, Maharashtra')?.code === '27', 'state from an address');
check(inferStateFromAddress('D/1801, Pancham, Nanded City, Sinhagad Road, Pune 411068') === null, 'no state named: not guessed');
check(inferStateFromAddress('12 Delhi Road, Mumbai, Maharashtra 400001')?.code === '27', 'the state at the end of the address wins over a street name');
check(inferStateFromAddress('Plot 4, MIDC, Ahmedabad, Gujarat')?.code === '24', 'Gujarat');
check(inferStateFromAddress('Connaught Place, New Delhi')?.code === '07', 'New Delhi is Delhi');
check(inferStateFromAddress('Bhubaneswar, Orissa')?.code === '21', 'an old state name');
check(inferStateFromAddress('') === null && inferStateFromAddress(null) === null, 'blank address');
check(isValidGstinFormat('27BDCPK3585J3Z7') && isValidGstinFormat(' 27aadfz2948m1zi ') && !isValidGstinFormat('27BDCPK3585J3Z') && !isValidGstinFormat('XX'), 'GSTIN format');
check(gstinStateCode('27BDCPK3585J3Z7') === '27' && gstinStateCode('24AAAAA0000A1Z5') === '24' && gstinStateCode('99AAAAA0000A1Z5') === null && gstinStateCode('bad') === null, 'state from a GSTIN');
{
  const clean = reviewCustomerTax({ stateCode: '27', gstin: '27AADFZ2948M1ZI', address: 'Pune, Maharashtra' });
  check(clean.warnings.length === 0 && !clean.stateMismatch, 'matching state, GSTIN and address: no warning');
  const mismatch = reviewCustomerTax({ stateCode: '27', gstin: '24AAAAA0000A1Z5', address: 'Pune, Maharashtra' });
  check(mismatch.stateMismatch && mismatch.warnings.length === 1, 'GSTIN state differs from the chosen state: warning');
  check(reviewCustomerTax({ stateCode: '', gstin: '' }).warnings.length === 1, 'state not set: warning');
  check(reviewCustomerTax({ stateCode: '27', gstin: '12345' }).warnings.some(w => /does not look valid/.test(w)), 'bad GSTIN: warning');
  check(reviewCustomerTax({ stateCode: '24', gstin: '', address: 'Pune, Maharashtra' }).warnings.some(w => /address mentions Maharashtra/.test(w)), 'address says another state: warning');
}

console.log(`=== ALL INVOICE CALCULATION TESTS PASSED (${passed}) ===`);
