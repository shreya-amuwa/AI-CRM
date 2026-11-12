/**
 * Automation settings. Company contact details and panel URLs come from the
 * Apps Script's CFG; everything secret or environment-specific is read from
 * server environment variables (never from the database, never sent to browsers).
 */
import { STAGE_LABEL, type ClientStage } from './rules.js';

export const COMPANY = {
  senderName: 'Amuwa Corporation',
  teamPhone: '1800 - 843 - 0177',
  teamEmail: 'meta@amuwa.com',
  techPhone: '918879690034',
  companyPhone: '1800 - 843 - 0177',
  companyEmail: 'meta@amuwa.com'
} as const;

/** Client panel login page per CRM department (departments.slug). Only Wabastore is automated for now. */
export const PANEL_URLS: Record<string, string> = {
  wabastore: 'https://chat.wabastore.shop/login'
};

/**
 * The WhatsApp `status` text the Automation Builder router matches on, per stage. The defaults are the sheet's dropdown values (STAGE_LABEL) and
 * are what the router has always matched. WHATSAPP_STATUS_<STAGE> (e.g. WHATSAPP_STATUS_META_VERIFICATION) replaces one - change the router's
 * condition to the same text at the same time. A pending stage can never be given a "completed" wording: such an override is ignored.
 */
export function whatsappStatus(stage: ClientStage, env: NodeJS.ProcessEnv = process.env): string {
  const base = STAGE_LABEL[stage];
  const v = env[`WHATSAPP_STATUS_${stage}`]?.trim();
  if (!v || v.length > 60 || /[\u0000-\u001f]/.test(v)) return base;
  if (stage !== 'COMPLETED' && /complet/i.test(v)) return base;
  return v;
}

export type AutomationMode = 'off' | 'dry_run' | 'live';

export interface AutomationSettings {
  /** off: nothing is processed. dry_run: messages are prepared and logged, never sent. live: sent. */
  mode: AutomationMode;
  email: {
    provider: 'smtp' | 'resend' | 'brevo' | null;
    apiKey: string | null;
    /** provider "smtp" (nodemailer): e.g. smtp.gmail.com with the mailbox's app password. */
    smtp: { host: string; port: number; secure: boolean; user: string; pass: string } | null;
    /** For tests only: point the provider at a local mock server. */
    apiBaseUrl: string | null;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    cc: string[];
    bcc: string[];
  };
  whatsapp: {
    webhookUrl: string | null;
    /** The script sent "Google Sheets"; kept unless the WhatsApp router is changed. */
    source: string;
  };
  /** When set (comma separated e-mails and phone numbers), only these recipients get messages. */
  testRecipients: { emails: Set<string>; phones: Set<string> } | null;
  /** The script's REQUIRE_VALID_WHATSAPP: also skip the email when the WhatsApp number is invalid. */
  requireValidWhatsapp: boolean;
  /** The CRM's web address, for the links in emails to staff (null: no link is added). */
  appUrl: string | null;
  /** Key for the client password kept (encrypted) until the completion email is sent. */
  secretKey: string | null;
  /** Bearer secret for /internal/automations/dispatch (also accepts CRON_SECRET). */
  dispatchSecrets: string[];
}

const list = (v: string | undefined) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

function httpsUrl(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Where the CRM is hosted. Every link in a client e-mail (sign-in page, set-password link) starts here unless APP_URL says otherwise. */
export const DEFAULT_APP_URL = 'https://crm.amuwacorporation.com';

/** The CRM's own web address (for the links in e-mails): APP_URL when set, otherwise the production domain above. */
function appBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = httpsUrl(env.APP_URL);
  return (explicit ?? DEFAULT_APP_URL).replace(/\/+$/, '');
}

/** Read on every use, so a change of environment variable needs no code change. */
export function automationSettings(): AutomationSettings {
  const env = process.env;
  const mode = (env.AUTOMATION_MODE || 'dry_run').trim().toLowerCase();
  const provider = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
  const from = (env.EMAIL_FROM || '').trim();
  const m = /^(.*)<([^>]+)>\s*$/.exec(from);
  const tests = list(env.AUTOMATION_TEST_RECIPIENTS);
  return {
    mode: mode === 'live' || mode === 'off' ? mode : 'dry_run',
    email: {
      provider: provider === 'smtp' || provider === 'resend' || provider === 'brevo' ? provider : null,
      apiKey: env.EMAIL_API_KEY?.trim() || null,
      smtp:
        env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASS
          ? {
              host: env.SMTP_HOST.trim(),
              port: Number(env.SMTP_PORT) || 465,
              // port 465 is implicit TLS; 587 upgrades with STARTTLS
              secure: env.SMTP_SECURE ? env.SMTP_SECURE.trim().toLowerCase() === 'true' : (Number(env.SMTP_PORT) || 465) === 465,
              user: env.SMTP_USER.trim(),
              pass: env.SMTP_PASS.replace(/\s+/g, '')
            }
          : null,
      apiBaseUrl: httpsUrl(env.EMAIL_API_BASE_URL),
      fromName: (m ? m[1].trim().replace(/^"|"$/g, '') : '') || COMPANY.senderName,
      fromEmail: (m ? m[2].trim() : from) || COMPANY.teamEmail,
      replyTo: env.EMAIL_REPLY_TO?.trim() || COMPANY.teamEmail,
      cc: list(env.EMAIL_CC),
      bcc: list(env.EMAIL_BCC)
    },
    whatsapp: {
      webhookUrl: httpsUrl(env.WHATSAPP_WEBHOOK_URL),
      source: env.WHATSAPP_SOURCE?.trim() || 'Google Sheets'
    },
    testRecipients: tests.length
      ? {
          emails: new Set(tests.filter(t => t.includes('@')).map(t => t.toLowerCase())),
          phones: new Set(tests.filter(t => !t.includes('@')).map(t => t.replace(/\D/g, '').slice(-10)))
        }
      : null,
    requireValidWhatsapp: (env.AUTOMATION_REQUIRE_VALID_WHATSAPP || '').trim().toLowerCase() === 'true',
    appUrl: appBaseUrl(env),
    secretKey: env.AUTOMATION_SECRET_KEY?.trim() || null,
    dispatchSecrets: [env.AUTOMATION_DISPATCH_SECRET, env.CRON_SECRET].map(s => s?.trim() || '').filter(s => s.length >= 16)
  };
}

/** Channels whose provider is configured (in live mode only these are claimed; the rest wait). */
export function liveChannels(s: AutomationSettings): ('EMAIL' | 'WHATSAPP')[] {
  const out: ('EMAIL' | 'WHATSAPP')[] = [];
  if ((s.email.provider === 'smtp' && s.email.smtp) || (s.email.provider && s.email.provider !== 'smtp' && s.email.apiKey)) out.push('EMAIL');
  if (s.whatsapp.webhookUrl) out.push('WHATSAPP');
  return out;
}

/**
 * E-mails addressed to CLIENTS (onboarding, payment requests, invoices, renewal reminders, client logins) can go out from a client-facing
 * address on its own domain: EMAIL_FROM_CLIENT (e.g. "Amuwa <hello@amuwa.com>") and EMAIL_REPLY_TO_CLIENT. Staff, HR and careers e-mails
 * keep EMAIL_FROM (e.g. on amuwacorporation.com). Both go through the SAME mail account (EMAIL_PROVIDER / EMAIL_API_KEY): with Resend,
 * verify both domains in that one account. Not set: everything uses EMAIL_FROM, as before.
 */
export function clientEmailSettings(s: AutomationSettings = automationSettings()): AutomationSettings {
  const from = (process.env.EMAIL_FROM_CLIENT || '').trim();
  const replyTo = process.env.EMAIL_REPLY_TO_CLIENT?.trim();
  if (!from && !replyTo) return s;
  const m = /^(.*)<([^>]+)>\s*$/.exec(from);
  const fromEmail = from ? (m ? m[2].trim() : from) : s.email.fromEmail;
  const fromName = (m ? m[1].trim().replace(/^"|"$/g, '') : '') || s.email.fromName;
  return { ...s, email: { ...s.email, fromEmail, fromName, replyTo: replyTo || s.email.replyTo } };
}
