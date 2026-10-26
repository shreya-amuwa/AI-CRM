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
