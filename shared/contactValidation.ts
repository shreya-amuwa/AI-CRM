/**
 * Validation of the contact details the automations send to: an Indian mobile number and a website.
 * One implementation for the forms, the API and the sender, so a value that passes here is one the
 * WhatsApp / email automation can really use.
 */

/**
 * A clean 10-digit Indian mobile number, or '' if it is not one (the Apps Script's cleanPhone_):
 *   +91 89283 94849, 918928394849, 08928394849 -> 8928394849
 * It must start with 6-9, have at least 4 different digits and not be a 0123... / 9876... run.
 */
export function cleanIndianMobile(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return '';
  if (new Set(d).size < 4) return '';
  if ('01234567890123456789'.includes(d) || '98765432109876543210'.includes(d)) return '';
  return d;
}

/** Why a mobile number was refused, in words for the person typing it. Null when it is fine. */
export function mobileProblem(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return 'Enter the mobile number.';
  if (/[^0-9+()\-\s.]/.test(text)) return 'A mobile number can only have digits, spaces and + - ( ).';
  if (cleanIndianMobile(text)) return null;
  let d = text.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10) return 'Enter a 10-digit mobile number (with or without +91).';
  if (!/^[6-9]/.test(d)) return 'An Indian mobile number starts with 6, 7, 8 or 9.';
  return 'This does not look like a real mobile number.';
}

export const NO_WEBSITE = 'NO_WEBSITE';

/**
 * A website the customer really has: a web address with a proper domain (no spaces, no "a", no
 * "localhost", no IP address). "www.example.com" becomes "https://www.example.com".
 */
export function normalizeWebsite(raw: unknown): { url: string; error: null } | { url: null; error: string } {
  let v = String(raw ?? '').trim();
  if (!v) return { url: null, error: 'Enter the website address.' };
  if (/\s/.test(v)) return { url: null, error: 'A website address has no spaces.' };
  if (v.length > 500) return { url: null, error: 'The website address is too long.' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:\/\//i.test(v)) return { url: null, error: 'Use a web address that starts with http:// or https://.' };
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { url: null, error: 'This is not a valid website address (for example https://www.example.com).' };
  }
  if (u.username || u.password) return { url: null, error: 'The website address cannot contain a user name or password.' };
  const host = u.hostname.toLowerCase();
  const labels = host.split('.');
  const validLabels = labels.every(l => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l));
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || !validLabels || !/^[a-z]{2,24}$/.test(tld) || host === 'localhost') {
    return { url: null, error: 'This is not a valid website address (for example https://www.example.com).' };
  }
  return { url: u.href.replace(/^(https?:\/\/[^/?#]+)\/$/, '$1'), error: null };
}
