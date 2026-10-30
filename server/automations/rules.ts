/**
 * Rules carried over unchanged from the Google Apps Script ("Client Onboarding").
 */

/** EMAIL_RE from the script. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** cleanPhone_() from the script: a clean 10-digit Indian mobile number, or '' if invalid (shared with the forms). */
export { cleanIndianMobile as cleanPhone } from '../../shared/contactValidation.js';

/** The stages (and the one extra message), as the sheet's dropdown (and the WhatsApp router) names them. */
export const STAGE_LABEL = {
  WEBSITE_PENDING: 'Website Pending',
  UNDER_REVIEW: 'Under Review',
  META_VERIFICATION: 'Meta Verification',
  COMPLETED: 'Status Completed',
  /** Sent once when the Technical Consultant authorizes the mini website we built for the customer. */
  WEBSITE_READY: 'Website Ready',
  /** Sent once after Accounts has created the client's panel login: a set-password link by e-mail, a plain "access is ready" WhatsApp (never a password). */
  ACCOUNT_CREATED: 'Account Created',
  /** Internal: the email to the Accounts payment desk (not a customer message). */
  ACCOUNTS_PAYMENT: 'Accounts payment request',
  /** The password the Meta Verifier set on the customer's WhatsApp panel, e-mailed to the customer once (never a WhatsApp message, never kept). */
  PANEL_CREDENTIALS: 'WhatsApp panel login',
  /** The Client Panel URL of one service, e-mailed to the customer on the Meta Verifier's request (e-mail only; no password, no token). */
  PANEL_LINK: 'Client panel link'
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
