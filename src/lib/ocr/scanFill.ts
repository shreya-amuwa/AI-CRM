import type { ShopScan } from './shopText';

export type FillField = 'name' | 'address' | 'phone';
export type Flags = Partial<Record<FillField, boolean>>;

/**
 * Which form fields a scan fills: the empty ones, and ones that still hold a value read from an EARLIER photo - never something the person typed.
 * `fromPhoto` says which fields currently hold a value read from a photo; `check` which of those the reader was unsure about.
 */
export function planFill(
  scan: ShopScan,
  current: Record<FillField, string>,
  fromPhoto: Flags
): { values: Partial<Record<FillField, string>>; fromPhoto: Flags; check: Flags } {
  const values: Partial<Record<FillField, string>> = {};
  const nextFrom: Flags = { ...fromPhoto };
  const check: Flags = {};
  const offer: [FillField, { value: string; check: boolean } | null | undefined][] = [
    ['name', scan.shopName],
    ['address', scan.address],
    ['phone', scan.phones[0]]
  ];
  for (const [field, found] of offer) {
    if (found && (!current[field] || fromPhoto[field])) {
      values[field] = found.value;
      nextFrom[field] = true;
      check[field] = found.check;
    }
  }
  return { values, fromPhoto: nextFrom, check };
}

// ---- the Add Lead form (Field Visit): more fields, and a value the person typed is never replaced without asking -------------------------
export type LeadFillField = 'company' | 'phone' | 'address' | 'email' | 'businessCategory' | 'notes';
export type LeadFlags = Partial<Record<LeadFillField, boolean>>;
export type LeadOffer = { value: string; check: boolean };

/** The shop types the reader guesses that mean the same as one of the form's business categories (nothing else is mapped: no guessing). */
const CATEGORY_EQUIVALENT: Record<string, string> = {
  'Restaurant / Food': 'Restaurant / Food',
  Jewellers: 'Jewellery / Gold',
  'Salon / Beauty': 'Beauty / Salon',
  'Education / Coaching': 'Education',
  'Pharmacy / Medical store': 'Healthcare'
};

/** What a scan can put into the lead form. The customer's own name is not on a shop board, so it is never offered. */
export function leadOffers(scan: ShopScan, categories: readonly string[]): Partial<Record<LeadFillField, LeadOffer>> {
  const out: Partial<Record<LeadFillField, LeadOffer>> = {};
  if (scan.shopName) out.company = scan.shopName;
  if (scan.phones[0]) out.phone = scan.phones[0];
  if (scan.address) out.address = scan.address;
  if (scan.email) out.email = scan.email;
  const category = scan.category ? CATEGORY_EQUIVALENT[scan.category] : undefined;
  if (category && categories.includes(category)) out.businessCategory = { value: category, check: true };
  const extra = [
    scan.gstin ? `GSTIN ${scan.gstin.value}${scan.gstin.check ? ' (check)' : ''}` : null,
    scan.website ? `Website ${scan.website.value}` : null,
    scan.pincode && !(scan.address?.value ?? '').includes(scan.pincode.value) ? `PIN ${scan.pincode.value}` : null,
    scan.category && !category ? `Shop type (guess) ${scan.category}` : null
  ].filter(Boolean);
  if (extra.length > 0) out.notes = { value: `From the shop photo: ${extra.join(' · ')}`, check: true };
  return out;
}

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Which lead fields a scan fills: empty ones, and ones still holding a value read from an EARLIER photo (not edited since). A field the
 * person typed or corrected is kept; when the new photo reads something different there, it is returned as a conflict for the person to
 * accept or ignore.
 */
export function planLeadFill(
  offers: Partial<Record<LeadFillField, LeadOffer>>,
  current: Record<LeadFillField, string>,
  fromPhoto: LeadFlags
): { values: Partial<Record<LeadFillField, string>>; fromPhoto: LeadFlags; check: LeadFlags; conflicts: { field: LeadFillField; value: string }[] } {
  const values: Partial<Record<LeadFillField, string>> = {};
  const nextFrom: LeadFlags = { ...fromPhoto };
  const check: LeadFlags = {};
  const conflicts: { field: LeadFillField; value: string }[] = [];
  for (const field of Object.keys(offers) as LeadFillField[]) {
    const found = offers[field];
    if (!found) continue;
    const now = current[field] ?? '';
    if (!now.trim() || fromPhoto[field]) {
      values[field] = found.value;
      nextFrom[field] = true;
      check[field] = found.check;
    } else if (!same(now, found.value)) {
      conflicts.push({ field, value: found.value });
    }
  }
  return { values, fromPhoto: nextFrom, check, conflicts };
}
