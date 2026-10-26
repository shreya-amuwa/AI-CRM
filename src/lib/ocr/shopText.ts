/**
 * Turns the text read from a photo of a shop board / visiting card into the fields of a field visit.
 * Pure functions (no browser, no network): the OCR engine hands over lines with their confidence and position; this finds
 *   - phone numbers (Indian mobile and landline patterns)      - e-mail, website, GSTIN, pincode
 *   - the shop name (the most prominent text that is not contact data)
 *   - the address (lines that look like one, plus the pincode line)    - a shop type guess
 * Nothing here is trusted blindly: every value carries a `check` flag and the form shows it for the person to confirm.
 */
export interface OcrLine {
  text: string;
  /** 0-100, the engine's own confidence for the line. */
  confidence: number;
  /** Height of the line's box in pixels: a bigger line is a more prominent one (the shop name). */
  height: number;
  /** Vertical position (top edge) in pixels. */
  top: number;
}

export interface ScanValue {
  value: string;
  /** True when the value is uncertain (low engine confidence, or a loose match) and must be checked by the person. */
  check: boolean;
}

export interface ShopScan {
  shopName: ScanValue | null;
  /** Other plausible names (next most prominent lines), for a one-tap swap. */
  nameAlternatives: string[];
  phones: ScanValue[];
  email: ScanValue | null;
  website: ScanValue | null;
  gstin: ScanValue | null;
  pincode: ScanValue | null;
  address: ScanValue | null;
  category: string | null;
  /** Everything that was read, kept with the visit so a wrong guess can be understood later. */
  rawText: string;
}

const CONFIDENT = 70;

// ---- digits the engine often confuses, only repaired inside strings that are mostly digits (see formatPhone)
const DIGIT_LOOKALIKE: Record<string, string> = { O: '0', o: '0', Q: '0', D: '0', l: '1', I: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9' };

// a run of 10-14 digits / digit-lookalike letters with separators (validated and repaired by formatPhone)
const PHONE_RE = /(?<![A-Za-z\d])(?:\+\s?)?\d(?:[\s.-]?[\dOolI|SsBZzQ]){9,13}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/;
// the engine often drops or swaps a character of a long code: the 13-character start of a GSTIN is still worth showing (marked as uncertain)
const GSTIN_LOOSE_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]{1,4}\b/;
const WEBSITE_RE = /\b(?:https?:\/\/)?(?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+\b|\b[a-z0-9-]+\.(?:com|in|co\.in|net|org|shop|store)\b/gi;
const PINCODE_RE = /(?<![\d])[1-9]\d{2}\s?\d{3}(?![\d])/g;

const ADDRESS_WORDS = /\b(road|rd\.?|street|st\.?|nagar|market|shop\s*no|near|opp\.?|opposite|plot|sector|floor|colony|chowk|bazaar|bazar|complex|lane|marg|vihar|circle|mall|building|bldg|tower|phase|block|ward|village|gali|main|cross|layout|puram|enclave|park|highway|nh-?\d+|ganj|pura|opp)\b/i;

const CATEGORIES: [string, RegExp][] = [
  ['Pharmacy / Medical store', /\b(pharmacy|medical|medicos?|chemist|drug|dawai|clinic|pathology|diagnostic)\b/i],
  ['Mobile & electronics', /\b(mobile|telecom|electronics?|computers?|laptops?|digital|cellular|gadgets?|appliances?)\b/i],
  ['Garments / Clothing', /\b(garments?|clothing|textiles?|fashion|boutique|sarees?|tailors?|readymade|apparels?|collection|wear)\b/i],
  ['Grocery / Kirana', /\b(kirana|grocery|provision|general\s*store|supermarket|mart|departmental|traders?|stores?)\b/i],
  ['Restaurant / Food', /\b(restaurant|hotel|cafe|caf[eé]|dhaba|bakery|sweets?|bhandar|foods?|kitchen|biryani|pizza|juice|tea|snacks?)\b/i],
  ['Salon / Beauty', /\b(salon|parlou?r|beauty|spa|hair|unisex|makeover)\b/i],
  ['Hardware / Building', /\b(hardware|paints?|cement|sanitary|tiles?|electricals?|plywood|steel|building\s*materials?|pipes?)\b/i],
  ['Jewellers', /\b(jewell?ers?|jewellery|jewelry|gold|silver|diamonds?)\b/i],
  ['Furniture / Interiors', /\b(furniture|interiors?|mattress|decor|furnishing)\b/i],
  ['Stationery / Books', /\b(stationery|books?|xerox|print(?:ing|ers?)?|photostat)\b/i],
  ['Optical', /\b(optical|opticals|eyewear|spectacles?|lens)\b/i],
  ['Auto / Garage', /\b(auto|motors?|garage|tyres?|tires?|spares?|automobiles?|bikes?)\b/i],
  ['Education / Coaching', /\b(academy|classes|coaching|institute|school|tutorials?|education)\b/i]
];

const clean = (s: string) => s.replace(/[|_~^`]+/g, ' ').replace(/\s+/g, ' ').trim();
const letterCount = (s: string) => (s.match(/[A-Za-z]/g) || []).length;

/** +91 98112 00000 for a mobile; the digits as read for anything else. Letters the engine mistook for digits (O, l, I, S, B, Z ...) are repaired, but only in a string that is mostly digits. */
export function formatPhone(raw: string): string | null {
  const compact = raw.replace(/[\s.()-]/g, '');
  const realDigits = (compact.match(/\d/g) || []).length;
  if (realDigits < 4) return null;
  const mapped = compact.replace(/[A-Za-z|]/g, c => DIGIT_LOOKALIKE[c] ?? '#');
  if (mapped.includes('#')) return null;
  const digits = mapped.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  if (/^[6-9]\d{9}$/.test(national)) return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
  if (/^0\d{9,11}$/.test(digits)) return digits;
  return null;
}

const titleCase = (s: string) =>
  s === s.toUpperCase() && letterCount(s) > 3
    ? s.toLowerCase().replace(/(^|[\s&(/-])([a-z])/g, (_m, p, c: string) => p + c.toUpperCase())
    : s;

function cleanName(s: string): string {
  return titleCase(clean(s.replace(/[^A-Za-z0-9&'().,/ -]/g, ' ')).replace(/^[\W_]+|[\W_]+$/g, ''));
}

export function parseShopText(lines: OcrLine[]): ShopScan {
  const usable = lines.map(l => ({ ...l, text: clean(l.text) })).filter(l => l.text.length > 0);
  const rawText = usable.map(l => l.text).join('\n');
  const used = new Set<number>(); // lines explained by contact data, so they are not taken for the name

  // ---- phones (a line may hold several; digits repaired token by token)
  const phones: ScanValue[] = [];
  const seenPhones = new Set<string>();
  usable.forEach((l, i) => {
    for (const m of l.text.match(PHONE_RE) || []) {
      const f = formatPhone(m);
      if (f && !seenPhones.has(f)) {
        seenPhones.add(f);
        phones.push({ value: f, check: l.confidence < CONFIDENT });
        used.add(i);
      }
    }
  });
  const phoneDigits = new Set([...seenPhones].map(p => p.replace(/\D/g, '').slice(-10)));

  // ---- e-mail / website / GSTIN
  let email: ScanValue | null = null;
  let website: ScanValue | null = null;
  let gstin: ScanValue | null = null;
  usable.forEach((l, i) => {
    if (!email) {
      const m = l.text.match(EMAIL_RE);
      if (m) {
        email = { value: m[0].replace(/\s/g, '').toLowerCase(), check: l.confidence < CONFIDENT };
        used.add(i);
      }
    }
    if (!gstin) {
      const compact = l.text.toUpperCase().replace(/[\s:.-]/g, '').replace(/^GSTIN?/, '').replace(/^GST/, '');
      const m = compact.match(GSTIN_RE) || l.text.toUpperCase().match(GSTIN_RE);
      if (m) {
        gstin = { value: m[0], check: l.confidence < CONFIDENT };
        used.add(i);
      } else {
        const loose = compact.match(GSTIN_LOOSE_RE);
        if (loose) {
          gstin = { value: loose[0], check: true };
          used.add(i);
        }
      }
    }
  });
  const emailDomain = email ? (email as ScanValue).value.split('@')[1] : '';
  usable.forEach((l, i) => {
    if (website) return;
    for (const m of l.text.match(WEBSITE_RE) || []) {
      if (m.toLowerCase() === emailDomain || l.text.includes('@')) continue;
      website = { value: m.toLowerCase(), check: l.confidence < CONFIDENT };
      used.add(i);
      return;
    }
  });

  // ---- address: lines with address words, plus the pincode line (digits that are not part of a phone number)
  let pincode: ScanValue | null = null;
  const addressIdx: number[] = [];
  usable.forEach((l, i) => {
    if (used.has(i) && !ADDRESS_WORDS.test(l.text)) return;
    const hasWord = ADDRESS_WORDS.test(l.text);
    let pin: string | null = null;
    for (const m of l.text.match(PINCODE_RE) || []) {
      const d = m.replace(/\s/g, '');
      if (![...phoneDigits].some(p => p.includes(d))) pin = d;
    }
    if (pin && !pincode) {
      pincode = { value: pin, check: l.confidence < CONFIDENT };
      if (!addressIdx.includes(i)) addressIdx.push(i);
    }
    if (hasWord && !addressIdx.includes(i)) addressIdx.push(i);
  });
  // a line directly above the pincode line is usually the area / city
  addressIdx.sort((a, b) => a - b);
  const addressLines = addressIdx.map(i => usable[i]);
  const addressText = addressLines.map(l => l.text.replace(PINCODE_RE, m => m).replace(/\s*[,;]\s*$/, '')).join(', ');
  const address: ScanValue | null = addressText
    ? { value: addressText, check: addressLines.some(l => l.confidence < CONFIDENT) || !pincode }
    : null;
  addressIdx.forEach(i => used.add(i));

  // ---- the shop name: the most prominent remaining text (tall + readable), joined with a line right below it of similar size
  const candidates = usable
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => !used.has(i) && letterCount(l.text) >= 3 && letterCount(l.text) >= l.text.replace(/\s/g, '').length * 0.5)
    .map(c => ({ ...c, score: c.l.height * (0.4 + c.l.confidence / 100) }))
    .sort((a, b) => b.score - a.score);
  let shopName: ScanValue | null = null;
  const alternatives: string[] = [];
  if (candidates.length) {
    const top = candidates[0];
    let name = top.l.text;
    const near = (x: (typeof usable)[number], j: number, isAbove: boolean) =>
      j !== top.i && !used.has(j) && letterCount(x.text) >= 3 && x.height >= top.l.height * 0.7 &&
      (isAbove ? x.top < top.l.top && top.l.top - (x.top + x.height) < top.l.height * 1.2 : x.top > top.l.top && x.top - (top.l.top + top.l.height) < top.l.height * 1.2);
    const aboveIdx = usable.findIndex((x, j) => near(x, j, true));
    const belowIdx = usable.findIndex((x, j) => near(x, j, false));
    const joined = new Set([top.i, ...(aboveIdx >= 0 ? [aboveIdx] : []), ...(belowIdx >= 0 ? [belowIdx] : [])]);
    if (aboveIdx >= 0) name = `${usable[aboveIdx].text} ${name}`;
    if (belowIdx >= 0) name = `${name} ${usable[belowIdx].text}`;
    const cleaned = cleanName(name);
    // uncertain when the engine was unsure, or another, separate line is nearly as prominent
    const rival = candidates.find(c => !joined.has(c.i));
    if (cleaned.length >= 3) shopName = { value: cleaned, check: top.l.confidence < CONFIDENT || (!!rival && rival.score > top.score * 0.85) };
    for (const c of candidates.filter(c => !joined.has(c.i)).slice(0, 3)) {
      const alt = cleanName(c.l.text);
      if (alt.length >= 3 && alt !== cleaned && !cleaned.includes(alt)) alternatives.push(alt);
    }
  }

  // ---- shop type from every word that was read
  const category = CATEGORIES.find(([, re]) => re.test(rawText))?.[0] ?? null;

  return { shopName, nameAlternatives: alternatives, phones, email, website, gstin, pincode, address, category, rawText };
}
