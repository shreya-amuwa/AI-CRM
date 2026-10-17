/**
 * GST reference data and helpers shared by the browser, the API and the PDF.
 * The database holds the same state list (public.gst_states) and applies the same rules again when an invoice is
 * issued; nothing here is trusted on its own.
 */

/** The company's registered state: Maharashtra. Supplies to a customer in another state are inter-state (IGST). */
export const COMPANY_STATE_CODE = '27';
export const COMPANY_GSTIN = '27BDCPK3585J3Z7';

export interface GstState {
  code: string;
  name: string;
}

/** State and union-territory codes used in a GSTIN (the first two digits). */
export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' }
];

const BY_CODE = new Map(GST_STATES.map(s => [s.code, s.name]));

export const stateName = (code: string | null | undefined): string | null => (code ? BY_CODE.get(code) ?? null : null);
export const isStateCode = (code: string | null | undefined): boolean => !!code && BY_CODE.has(code);

const squash = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z]+/g, ' ').trim();

/** Names people write in an address that are not the official state name. */
const ALIASES: Record<string, string> = {
  orissa: '21',
  uttaranchal: '05',
  pondicherry: '34',
  'j and k': '01',
  'jammu kashmir': '01',
  'new delhi': '07',
  'nct of delhi': '07',
  telengana: '36',
  'andaman nicobar islands': '35',
  'dadra and nagar haveli': '26',
  'daman and diu': '26'
};

/**
 * The state named in an address, or null when none (or none clearly) is. The LAST state named wins, because an
 * address ends with its state ("Nanded City, Pune 411068, Maharashtra"); a street called "Delhi Road" earlier does not.
 */
export function inferStateFromAddress(address: string | null | undefined): GstState | null {
  const text = ` ${squash(address ?? '')} `;
  if (text.trim() === '') return null;
  let best: { at: number; code: string } | null = null;
  const consider = (name: string, code: string) => {
    const needle = ` ${squash(name)} `;
    const at = text.lastIndexOf(needle);
    if (at >= 0 && (!best || at > best.at)) best = { at, code };
  };
  for (const s of GST_STATES) if (s.code !== '97') consider(s.name, s.code);
  for (const [alias, code] of Object.entries(ALIASES)) consider(alias, code);
  const hit = best as { at: number; code: string } | null;
  return hit ? { code: hit.code, name: BY_CODE.get(hit.code)! } : null;
}

// ---------------------------------------------------------------------------
// GSTIN
// ---------------------------------------------------------------------------
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const normalizeGstin = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, '').toUpperCase();
export const isValidGstinFormat = (v: string | null | undefined): boolean => GSTIN_RE.test(normalizeGstin(v));
/** The state code a well-formed GSTIN starts with (null when the GSTIN is blank, malformed or has an unknown code). */
export function gstinStateCode(v: string | null | undefined): string | null {
  const g = normalizeGstin(v);
  return GSTIN_RE.test(g) && BY_CODE.has(g.slice(0, 2)) ? g.slice(0, 2) : null;
}

export type TaxTreatment = 'INTRA_STATE' | 'INTER_STATE';

/** Same state as the company: CGST + SGST. Another state: IGST. Null when the customer's state is not known yet. */
export function defaultTaxTreatment(customerStateCode: string | null | undefined): TaxTreatment | null {
  if (!isStateCode(customerStateCode)) return null;
  return customerStateCode === COMPANY_STATE_CODE ? 'INTRA_STATE' : 'INTER_STATE';
}

export interface CustomerTaxReview {
  /** Problems Accounts must look at before issuing; empty when the customer's tax details agree with each other. */
  warnings: string[];
  /** The GSTIN's state differs from the state chosen for the invoice. */
  stateMismatch: boolean;
}

/** Checks the customer's state, state code and GSTIN against each other (used for the warning in the builder). */
export function reviewCustomerTax(input: { state?: string | null; stateCode?: string | null; gstin?: string | null; address?: string | null }): CustomerTaxReview {
  const warnings: string[] = [];
  const code = input.stateCode || '';
  const gstin = normalizeGstin(input.gstin);
  let stateMismatch = false;
  if (!isStateCode(code)) warnings.push('The customer state is not set. Choose it so the right tax (CGST + SGST or IGST) is applied.');
  if (gstin && !isValidGstinFormat(gstin)) warnings.push('The GSTIN does not look valid. Check it against the customer\'s GST certificate.');
  const fromGstin = gstinStateCode(gstin);
  if (isStateCode(code) && fromGstin && fromGstin !== code) {
    stateMismatch = true;
    warnings.push(`The GSTIN starts with ${fromGstin} (${stateName(fromGstin)}) but the state chosen is ${code} (${stateName(code)}). Verify the state, or confirm the tax treatment yourself.`);
  }
  const fromAddress = inferStateFromAddress(input.address);
  if (isStateCode(code) && fromAddress && fromAddress.code !== code) {
    warnings.push(`The address mentions ${fromAddress.name} but the state chosen is ${stateName(code)}.`);
  }
  return { warnings, stateMismatch };
}
