/**
 * Rules carried over unchanged from the Google Apps Script ("Client Onboarding").
 */

/** EMAIL_RE from the script. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * cleanPhone_() from the script: a clean 10-digit Indian mobile number, or '' if invalid.
 *   918928394849 -> 8928394849,  08928394849 -> 8928394849
 * Must start with 6-9, have at least 4 different digits and not be a 0123... / 9876... run.
 */
export function cleanPhone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return '';
  if (new Set(d).size < 4) return '';
  if ('01234567890123456789'.includes(d) || '98765432109876543210'.includes(d)) return '';
  return d;
}

/** The four stages, as the sheet's dropdown (and the WhatsApp router) names them. */
export const STAGE_LABEL = {
  WEBSITE_PENDING: 'Website Pending',
  UNDER_REVIEW: 'Under Review',
  META_VERIFICATION: 'Meta Verification',
  COMPLETED: 'Status Completed'
} as const;
export type ClientStage = keyof typeof STAGE_LABEL;

/** For logs shown in the CRM: a***@gmail.com, 91******6055. */
export function maskEmail(e: string): string {
  const [user, domain] = e.split('@');
  return domain ? `${user.slice(0, 1)}***@${domain}` : '***';
}
export function maskPhone(p: string): string {
  return p.length > 4 ? `${p.slice(0, 2)}${'*'.repeat(Math.max(0, p.length - 6))}${p.slice(-4)}` : '****';
}
