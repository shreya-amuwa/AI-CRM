import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import type { AttemptOutcome, EmailErrorCategory } from './classify.js';
import type { ProviderName } from './routing.js';

/**
 * The shared record around every send (migration 20270129000100): email_send_begin before, email_send_finish after.
 *
 * It FAILS OPEN: when the database cannot be reached (or the migration has not been run yet) the e-mail is still sent exactly as before
 * (no automatic CC, no shared quota or idempotency check), because a sign-in code or an invoice must not be blocked by the log. A short
 * warning is written; nothing secret or personal is logged.
 */
export type EmailCategory = 'AUTH' | 'CREDENTIALS' | 'RECRUITMENT' | 'INTERVIEW' | 'HR' | 'CLIENT_ONBOARDING' | 'META_VERIFICATION' | 'TECHNICAL'
  | 'ACCOUNTS' | 'INVOICE' | 'PAYMENT' | 'RENEWAL' | 'MEETING' | 'SUPPORT' | 'SALES' | 'GENERAL';
export type EmailApplication = 'CRM' | 'CANDIDATE_PORTAL' | 'CLIENT_PORTAL';
export type EmailPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

/** Categories that carry a one-time link, a code or a password: never a copy to anyone, whatever is configured. */
export const SENSITIVE_CATEGORIES: ReadonlySet<EmailCategory> = new Set(['AUTH', 'CREDENTIALS']);

export interface EmailContext {
  customerId?: string | null;
  applicationId?: string | null;
  profileId?: string | null;
  departmentId?: string | null;
  workflow?: string | null;
}

export interface BeginRequest {
  idempotencyKey?: string;
  application: EmailApplication;
  category: EmailCategory;
  template?: string;
  priority: EmailPriority;
  sensitive: boolean;
  to: string;
  cc: string[];
  bcc: string[];
  senderEmail: string;
  providers: ProviderName[];
  context: EmailContext;
}

export interface BeginAnswer {
  logId: string | null;
  duplicate: null | 'ACCEPTED' | 'IN_PROGRESS' | 'UNKNOWN_ACCEPTANCE';
  duplicateProvider?: ProviderName | null;
  duplicateRef?: string | null;
  cc: string[];
  bcc: string[];
  suppressed: string[];
  sender: { email: string; name: string; replyTo: string | null } | null;
  /** null: the database gave no answer (fail open: use the deployment's order, every provider allowed) */
  providers: { provider: ProviderName; allowed: boolean; reason: string | null }[] | null;
}

export interface FinishRequest {
  logId: string;
  status: 'ACCEPTED' | 'FAILED' | 'RETRY_PENDING' | 'UNKNOWN_ACCEPTANCE' | 'SUPPRESSED' | 'CANCELLED';
  provider?: ProviderName | null;
  providerMessageId?: string | null;
  fallbackUsed?: boolean;
  errorCategory?: EmailErrorCategory | string | null;
  attempts: { provider: ProviderName; outcome: AttemptOutcome; category?: string | null; status?: number | null; ref?: string | null; ms?: number }[];
  usage?: { provider: 'resend' | 'ses'; daily?: string | null; monthly?: string | null };
}

export interface Ledger {
  begin(r: BeginRequest): Promise<BeginAnswer>;
  finish(r: FinishRequest): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanContext = (c: EmailContext) => Object.fromEntries(Object.entries(c).filter(([k, v]) => typeof v === 'string' && (k === 'workflow' ? v.length <= 60 : UUID.test(v))));

/** Fail open: what is used when the database gives no answer. */
export function openAnswer(r: BeginRequest): BeginAnswer {
  return { logId: null, duplicate: null, cc: r.sensitive ? [] : r.cc, bcc: r.sensitive ? [] : r.bcc, suppressed: [], sender: null, providers: null };
}

let warnedAt = 0;
function warn(what: string, message: string) {
  // at most one line a minute (an outage must not flood the log)
  if (Date.now() - warnedAt < 60_000) return;
  warnedAt = Date.now();
  console.warn(JSON.stringify({ level: 'warn', msg: `email ledger: ${what} failed, sending without it`, error: message.slice(0, 160) }));
}

export const supabaseLedger: Ledger = {
  async begin(r) {
    try {
      const { data, error } = await getServiceClient().rpc('email_send_begin', {
        p: { ...r, context: cleanContext(r.context) }
      });
      if (error) {
        // a refusal by the database's own rules (a CC on an authentication e-mail) is a real answer, not an outage
        if (/VALIDATION_ERROR/.test(error.message)) throw new LedgerRefusal(error.message.replace(/^.*VALIDATION_ERROR:\s*/, ''));
        warn('begin', error.message);
        return openAnswer(r);
      }
      const d = (data ?? {}) as Record<string, unknown>;
      return {
        logId: typeof d.logId === 'string' ? d.logId : null,
        duplicate: (d.duplicate as BeginAnswer['duplicate']) ?? null,
        duplicateProvider: (d.provider as ProviderName) ?? null,
        duplicateRef: (d.providerMessageId as string) ?? null,
        cc: Array.isArray(d.cc) ? (d.cc as string[]) : [],
        bcc: Array.isArray(d.bcc) ? (d.bcc as string[]) : [],
        suppressed: Array.isArray(d.suppressed) ? (d.suppressed as string[]) : [],
        sender: (d.sender as BeginAnswer['sender']) ?? null,
        providers: Array.isArray(d.providers) ? (d.providers as BeginAnswer['providers']) : null
      };
    } catch (err) {
      if (err instanceof LedgerRefusal) throw err;
      warn('begin', err instanceof Error ? err.message : 'error');
      return openAnswer(r);
    }
  },
  async finish(r) {
    try {
      const { error } = await getServiceClient().rpc('email_send_finish', { p: r });
      if (error) warn('finish', error.message);
    } catch (err) {
      warn('finish', err instanceof Error ? err.message : 'error');
    }
  }
};

/** The ledger to use: the database when the server has its service key; none otherwise (tests, local scripts). */
export function defaultLedger(): Ledger | null {
  try {
    return hasServiceClient() ? supabaseLedger : null;
  } catch {
    return null; // the server has no Supabase settings at all (scripts, tests): send without the record, as before
  }
}

/** The database refused the e-mail by its own rules (e.g. a CC on an authentication e-mail): never sent. */
export class LedgerRefusal extends Error {}
