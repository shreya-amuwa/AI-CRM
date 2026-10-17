import { calculateInvoice } from '../../shared/invoiceCalc.js';
import type { InvoicePdfInput } from '../../server/invoices/pdf.js';

export interface FixtureOptions {
  treatment?: 'INTRA_STATE' | 'INTER_STATE';
  long?: boolean;
  devanagari?: boolean;
  reverseCharge?: boolean;
  terms?: string;
}

/** A snapshot like the one the database stores, with `n` service rows (rates 18% and, on every fourth row, 12%). */
export function sampleInvoice(n: number, o: FixtureOptions = {}): InvoicePdfInput {
  const treatment = o.treatment ?? 'INTRA_STATE';
  const rows = Array.from({ length: n }, (_, i) => ({
    particulars:
      i === 0
        ? 'WhatsApp Official Registration Platform Charges Bulk Campaign | Live Chat Platform | CRM | chat bot | No Number Banning Issue |'
        : i === 1
          ? '30K Utility Message for Campaign Unlimited Validity'
          : `Service line number ${i + 1} - ${'extended description of the service '.repeat(i % 3 === 0 ? 3 : 1)}`.trim(),
    quantity: i === 0 ? '1 Year' : i === 1 ? '30K Msg' : '1 Nos',
    rate: i % 4 === 3 ? 12 : 18,
    base: i === 0 ? 10000 : i === 1 ? 6000 : 1000 + i * 250.5
  }));
  const calc = calculateInvoice(rows.map(r => ({ baseAmount: r.base, taxRate: r.rate })), treatment);
  if (!calc.ok) throw new Error(JSON.stringify(calc.problems));
  const customer = o.long
    ? {
        name: 'Dr. Venkataraghavan Subramanian Iyer-Chattopadhyay',
        businessName: 'Zita Ayurveda & Wellness Private Limited, Unit 3',
        address: 'D/1801, Pancham Residency, Nanded City Phase 2, Sinhagad Road, Near Zensar Technologies IT Park, Opposite the Municipal Water Tank, Pune 411068, Maharashtra, India',
        contactPerson: 'Kshitij Ved', contactNumber: '9819900201', gstin: '27AADFZ2948M1ZI', state: 'Maharashtra', stateCode: '27'
      }
    : o.devanagari
      ? { name: 'प्रिया शर्मा', businessName: 'Sharma Opticals – “Prime”', address: '12 MG Road, Pune, Maharashtra', contactPerson: null, contactNumber: null, gstin: null, state: 'Maharashtra', stateCode: '27' }
      : { name: 'Kshitij Ved', businessName: 'Zita Ayurveda', address: 'D/1801, Pancham, Nanded City, Sinhagad Road, Pune 411068, Maharashtra', contactPerson: 'Kshitij Ved', contactNumber: '9819900201', gstin: '27AADFZ2948M1ZI', state: 'Maharashtra', stateCode: '27' };
  return {
    number: 'INV-2026-00022', invoiceDate: '2026-10-16', orderNumber: 'Verbal', customer,
    taxTreatment: treatment, reverseCharge: !!o.reverseCharge, terms: o.terms ?? '100% Payment Against supply.',
    lines: rows.map((r, i) => ({ position: i + 1, particulars: r.particulars, hsnSac: '998313', taxRate: r.rate, quantity: r.quantity,
      baseAmount: calc.lines[i].basePaise / 100, gstAmount: calc.lines[i].gstPaise / 100, totalAmount: calc.lines[i].totalPaise / 100 })),
    totals: {
      subtotal: calc.subtotalPaise / 100, cgstAmount: calc.cgstPaise / 100, sgstAmount: calc.sgstPaise / 100, igstAmount: calc.igstPaise / 100,
      totalGst: calc.totalGstPaise / 100, total: calc.totalPaise / 100, inWords: calc.words,
      breakdown: calc.groups.map(g => ({ rate: g.rateBp / 100, base: g.basePaise / 100, gst: g.gstPaise / 100, cgst: g.cgstPaise / 100, sgst: g.sgstPaise / 100, igst: g.igstPaise / 100 }))
    },
    issuedAt: '2026-10-16T09:30:00Z'
  };
}
