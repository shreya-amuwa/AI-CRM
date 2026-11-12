import type { InvoiceStage } from '../../shared/contracts.js';
import { COMPANY, automationSettings, clientEmailSettings, liveChannels, type AutomationSettings } from '../automations/config.js';
import { sendEmail, type MailAttachment } from '../automations/providers.js';
import { EMAIL_RE, maskEmail } from '../automations/rules.js';
import type { RenderedEmail } from '../automations/templates.js';
import { COMPANY_DETAILS } from './pdf.js';

/**
 * E-mailing an invoice PDF through the CRM's existing mail setup (nodemailer over SMTP, or Resend / Brevo), signed as the
 * configured sender (meta@amuwa.com by default). The outcome is exactly one of:
 *   SENT      the mail server accepted the message
 *   NOT_SENT  nothing was sent, on purpose or for a setup reason (dry run, test mode, no provider, no customer address)
 *   FAILED    sending was tried and failed (Accounts retries; nothing is marked sent)
 * It never reports SENT for anything else.
 */
export type InvoiceMailOutcome = { outcome: 'SENT' | 'NOT_SENT' | 'FAILED'; detail: string; messageId: string | null; to: string | null };

export interface InvoiceMailInput {
  stage: InvoiceStage;
  to: string | null;
  /**
   * Who the e-mail is for: the customer's contact name (the person on the invoice's billing details, else the customer's name on the record).
   * The legal business name stays on the PDF; it is only the fallback here, when no person's name is known.
   */
  contactName?: string | null;
  customerName: string;
  number: string;
  invoiceDate: string;
  total: string;
  pdf: Uint8Array;
  fileName: string;
}

/**
 * A name that is safe to put in a greeting and in the recipient's display name: control characters (which could break a mail header),
 * angle brackets, quotes and commas are removed, spaces are collapsed and the length is capped. Null when nothing usable is left.
 */
export function safeDisplayName(raw: unknown): string | null {
  const v = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/[<>"\\,;@]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return v.length ? v : null;
}

/** The name the e-mail is addressed to: the contact name, else the customer's name, else "Customer". */
export function recipientName(i: Pick<InvoiceMailInput, 'contactName' | 'customerName'>): string {
  return safeDisplayName(i.contactName) ?? safeDisplayName(i.customerName) ?? 'Customer';
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderInvoiceEmail(i: Omit<InvoiceMailInput, 'pdf' | 'to'>): RenderedEmail {
  const who = recipientName(i);
  const paid = i.stage === 'PAID';
  const subject = paid ? `Payment received - paid invoice ${i.number} from ${COMPANY_DETAILS.name}` : `Invoice ${i.number} from ${COMPANY_DETAILS.name}`;
  const lead = paid
    ? `Thank you. We have received your payment for invoice <b>${esc(i.number)}</b>. Your paid invoice (${esc(i.total)}) is attached to this e-mail as a PDF.`
    : `Please find your invoice <b>${esc(i.number)}</b> dated ${esc(i.invoiceDate)} for <b>${esc(i.total)}</b> attached to this e-mail as a PDF.`;
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">' +
    `<p>Dear ${esc(who)},</p>` +
    `<p>${lead}</p>` +
    (paid ? '' : '<p>Payment terms: 100% payment against supply. Our bank details are on the invoice.</p>') +
    `<p>You can also view and download your invoices any time from your Amuwa client dashboard.</p>` +
    `<p>For any question write to <a href="mailto:${COMPANY_DETAILS.email}">${COMPANY_DETAILS.email}</a> or call ${COMPANY_DETAILS.phones[0]} (toll free ${COMPANY_DETAILS.tollFree}).</p>` +
    `<p>Regards,<br>${esc(COMPANY_DETAILS.name)}<br><span style="color:#666">${esc(COMPANY_DETAILS.tagline)}</span></p></div>`;
  const text =
    `Dear ${who},\n\n` +
    (paid
      ? `Thank you. We have received your payment for invoice ${i.number}. Your paid invoice (${i.total}) is attached to this e-mail as a PDF.\n\n`
      : `Please find your invoice ${i.number} dated ${i.invoiceDate} for ${i.total} attached to this e-mail as a PDF.\n\nPayment terms: 100% payment against supply. Our bank details are on the invoice.\n\n`) +
    `You can also view and download your invoices any time from your Amuwa client dashboard.\n\n` +
    `For any question write to ${COMPANY_DETAILS.email} or call ${COMPANY_DETAILS.phones[0]} (toll free ${COMPANY_DETAILS.tollFree}).\n\nRegards,\n${COMPANY_DETAILS.name}\n${COMPANY_DETAILS.tagline}\n`;
  return { subject, html, text };
}

/** Why nothing can be sent right now, or null when sending is possible. Separate so it can be tested without a mail server. */
export function sendBlocker(s: AutomationSettings, to: string | null): string | null {
  if (!to || !EMAIL_RE.test(to)) return 'The customer has no valid e-mail address. Add it to the customer and retry.';
  if (s.mode === 'off') return 'E-mail sending is switched off (AUTOMATION_MODE=off).';
  if (s.mode !== 'live') return 'Dry run: nothing is sent while AUTOMATION_MODE is not "live".';
  if (!liveChannels(s).includes('EMAIL')) return 'E-mail sending is not configured (set EMAIL_PROVIDER and its credentials).';
  if (s.testRecipients && !s.testRecipients.emails.has(to.toLowerCase())) return `Test mode: ${maskEmail(to)} is not a test recipient.`;
  return null;
}

export async function sendInvoiceEmail(i: InvoiceMailInput, settings: AutomationSettings = clientEmailSettings(automationSettings())): Promise<InvoiceMailOutcome> {
  const to = (i.to || '').trim().toLowerCase() || null;
  const blocked = sendBlocker(settings, to);
  if (blocked) return { outcome: 'NOT_SENT', detail: blocked, messageId: null, to };
  const mail = renderInvoiceEmail(i);
  const attachment: MailAttachment = { filename: i.fileName, content: i.pdf, contentType: 'application/pdf' };
  try {
    const r = await sendEmail(settings, { email: to!, name: recipientName(i), display: true }, mail, [attachment]);
    if (r.ok) return { outcome: 'SENT', detail: `Sent from ${settings.email.fromEmail || COMPANY.teamEmail}`, messageId: r.ref, to };
    return { outcome: 'FAILED', detail: r.detail, messageId: null, to };
  } catch (e) {
    return { outcome: 'FAILED', detail: `Unexpected error: ${(e as Error)?.message ?? 'unknown'}`.slice(0, 300), messageId: null, to };
  }
}
