import { automationSettings, liveChannels } from '../automations/config.js';
import { sendEmail } from '../automations/providers.js';
import type { RenderedEmail } from '../automations/templates.js';
import { AppError } from '../http/errors.js';

/** Where the "Set your password" link lands: APP_URL (or the Vercel domain), else the page the request came from. */
export function setPasswordUrl(origin: string | undefined): string {
  const base = automationSettings().appUrl ?? safeOrigin(origin);
  if (!base) throw new AppError('SERVICE_UNAVAILABLE', 'Set APP_URL on the server so the set-password link can point to the CRM.');
  return `${base}/client/set-password`;
}

/** The client dashboard sign-in page (same base as the set-password link). */
export function clientLoginUrl(origin: string | undefined): string {
  return setPasswordUrl(origin).replace(/\/client\/set-password$/, '/client/login');
}

function safeOrigin(origin: string | undefined): string | null {
  try {
    const u = new URL(origin ?? '');
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.origin : null;
  } catch {
    return null;
  }
}

/** Sends one client e-mail, or says why it was not sent (the team can send it again later). */
export async function sendClientMail(to: { email: string; name: string }, mail: RenderedEmail): Promise<{ sent: boolean; detail?: string }> {
  const s = automationSettings();
  if (s.mode !== 'live') return { sent: false, detail: 'E-mails are switched off on the server (AUTOMATION_MODE is not "live").' };
  if (!liveChannels(s).includes('EMAIL')) return { sent: false, detail: 'E-mail sending is not set up on the server.' };
  if (s.testRecipients && !s.testRecipients.emails.has(to.email.toLowerCase())) {
    return { sent: false, detail: 'Test mode: only the test recipients get e-mails.' };
  }
  const r = await sendEmail(s, to, mail);
  return r.ok ? { sent: true } : { sent: false, detail: r.detail ?? 'The e-mail could not be sent.' };
}
