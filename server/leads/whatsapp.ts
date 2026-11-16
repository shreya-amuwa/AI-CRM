import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { WabastoreClient, wabastoreConfig, type MessageOutcome, type WabastoreFetch } from '../automations/subscriptionMessages.js';

/**
 * The lead welcome WhatsApp ("the services of Amuwa Corporation"), sent once when a lead is first given to a sales person
 * (docs/LEAD_WHATSAPP.md). The database decides and records (migration 20270103000200: the trigger on customers queues one dispatch per lead,
 * lead_whatsapp_claim / _finish / _status_update run it); this module only sends what the database hands over, through Wabastore.
 *
 * AUTOMATION_MODE_LEAD_WHATSAPP (when it is not set, AUTOMATION_MODE - the one switch the other messages use - decides):
 *   off      nothing is processed.
 *   dry_run  (default) each message is decided and logged as "would send"; nothing leaves the server.
 *   live     sent through Wabastore (WABASTORE_WEBHOOK_URL + WABASTORE_API_KEY), and only when the settings say the template is approved.
 *            Without WABASTORE_WEBHOOK_URL, live behaves like off and says so. AUTOMATION_TEST_RECIPIENTS still limits who receives it.
 */
export type LeadWhatsAppMode = 'off' | 'dry_run' | 'live';

export function leadWhatsAppMode(env: NodeJS.ProcessEnv = process.env): LeadWhatsAppMode {
  const v = (env.AUTOMATION_MODE_LEAD_WHATSAPP || env.AUTOMATION_MODE || 'dry_run').trim().toLowerCase();
  return v === 'live' || v === 'off' ? v : 'dry_run';
}

/** What this server does with the lead welcome message right now, in words for the Sales Department Head (shown with the settings). */
export function leadWhatsAppDelivery(env: NodeJS.ProcessEnv = process.env): { mode: LeadWhatsAppMode; ready: boolean; note: string } {
  const mode = leadWhatsAppMode(env);
  if (mode === 'off') return { mode, ready: false, note: 'The server has the lead welcome WhatsApp switched off (AUTOMATION_MODE_LEAD_WHATSAPP or AUTOMATION_MODE is "off"). Nothing is sent.' };
  if (mode === 'dry_run') return { mode, ready: false, note: 'The server is in test mode: messages are prepared and logged but NOT sent to leads. Set AUTOMATION_MODE_LEAD_WHATSAPP=live to send.' };
  if (!wabastoreConfig(env).webhookUrl) return { mode, ready: false, note: 'Wabastore is not connected on the server (WABASTORE_WEBHOOK_URL). Nothing is sent.' };
  return { mode, ready: true, note: 'Messages go through Wabastore.' };
}

/** The CRM values a template variable can be filled with (the settings put them in the template's {{1}}, {{2}} ... order). */
export const LEAD_WHATSAPP_VARIABLES = ['LEAD_NAME', 'LEAD_COMPANY', 'SALES_PERSON_NAME', 'SALES_PERSON_PHONE'] as const;
export type LeadWhatsAppVariable = (typeof LEAD_WHATSAPP_VARIABLES)[number];

/** What the database hands over for one message. */
export interface LeadWhatsAppJob {
  id: string;
  attempts: number;
  customerId: string;
  leadName: string | null;
  leadCompany: string | null;
  salesPersonName: string | null;
  salesPersonPhone: string | null;
  to: string;
  template: { name: string | null; language: string; approved: boolean; variables: string[] };
}

export interface LeadWhatsAppRunSummary {
  mode: LeadWhatsAppMode;
  claimed: number;
  dryRun: number;
  accepted: number;
  retrying: number;
  failed: number;
  skipped: number;
  note?: string;
  error?: string;
}

/** A sales person's phone as a reader would dial it: +91 and ten digits when it is an Indian mobile number, else as typed. */
function displayPhone(raw: string | null): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  const ten = digits.length >= 10 ? digits.slice(-10) : '';
  return /^[6-9]\d{9}$/.test(ten) ? `+91 ${ten}` : (raw ?? '').trim();
}

/** The value that fills one template variable (never empty: WhatsApp refuses a template with an empty parameter). */
export function leadVariableValue(job: LeadWhatsAppJob, v: string): string {
  switch (v) {
    case 'LEAD_NAME': return (job.leadName ?? '').trim() || 'there';
    case 'LEAD_COMPANY': return (job.leadCompany ?? '').trim() || (job.leadName ?? '').trim() || 'your business';
    case 'SALES_PERSON_NAME': return (job.salesPersonName ?? '').trim() || 'our team';
    case 'SALES_PERSON_PHONE': return displayPhone(job.salesPersonPhone) || 'our team';
    default: return '-';
  }
}

/**
 * The request to Wabastore: the approved template, its parameters in the template's order, and the same values by name. PROVISIONAL like the
 * paid-invoice message until Wabastore's send API is settled (this one function changes).
 */
export function leadWhatsAppPayload(job: LeadWhatsAppJob): Record<string, unknown> {
  const parameters = job.template.variables.map(v => leadVariableValue(job, v));
  return {
    reference: `lead-whatsapp:${job.id}`,
    to: job.to,
    template: job.template.name,
    language: job.template.language,
    parameters,
    variables: {
      leadName: leadVariableValue(job, 'LEAD_NAME'),
      leadCompany: leadVariableValue(job, 'LEAD_COMPANY'),
      salesPersonName: leadVariableValue(job, 'SALES_PERSON_NAME'),
      salesPersonPhone: leadVariableValue(job, 'SALES_PERSON_PHONE')
    }
  };
}

export interface LeadWhatsAppSender {
  send(job: LeadWhatsAppJob): Promise<MessageOutcome>;
}

export class WabastoreLeadSender implements LeadWhatsAppSender {
  private readonly client: WabastoreClient;
  constructor(doFetch?: WabastoreFetch, env: NodeJS.ProcessEnv = process.env) {
    this.client = new WabastoreClient(wabastoreConfig(env), doFetch);
  }
  send(job: LeadWhatsAppJob): Promise<MessageOutcome> {
    return this.client.post(job.to, leadWhatsAppPayload(job));
  }
}

export function leadWhatsAppSender(env: NodeJS.ProcessEnv = process.env): LeadWhatsAppSender | null {
  return wabastoreConfig(env).webhookUrl ? new WabastoreLeadSender(undefined, env) : null;
}

type Result = MessageOutcome | { outcome: 'DRY_RUN'; detail: string; code?: null; ref?: null };

const mask = (to: string) => `${to.slice(0, 5)}XXXXXX${to.slice(-4)}`;

/** Claim and send due messages. Never throws (it also runs right after a lead is assigned, next to the user's request). */
export async function runLeadWhatsApp(
  opts: { db?: SupabaseClient; limit?: number; sender?: LeadWhatsAppSender | null; mode?: LeadWhatsAppMode; budgetMs?: number } = {}
): Promise<LeadWhatsAppRunSummary> {
  const mode = opts.mode ?? leadWhatsAppMode();
  const out: LeadWhatsAppRunSummary = { mode, claimed: 0, dryRun: 0, accepted: 0, retrying: 0, failed: 0, skipped: 0 };
  if (mode === 'off') return { ...out, note: 'Lead welcome WhatsApp is switched off (AUTOMATION_MODE_LEAD_WHATSAPP=off).' };
  if (!opts.db && !hasServiceClient()) return { ...out, note: 'The server has no service key.' };
  const sender = opts.sender === undefined ? leadWhatsAppSender() : opts.sender;
  if (mode === 'live' && !sender) {
    return { ...out, mode: 'off', note: 'Live lead WhatsApp is not available: Wabastore is not connected (set WABASTORE_WEBHOOK_URL). Nothing was sent.' };
  }
  const db = opts.db ?? getServiceClient();
  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  try {
    const limit = opts.limit ?? 20;
    while (out.claimed < limit && Date.now() < deadline) {
      const claim = await db.rpc('lead_whatsapp_claim', { p_limit: Math.min(5, limit - out.claimed), p_mode: mode });
      if (claim.error) throw new Error(`lead_whatsapp_claim: ${claim.error.message}`);
      const jobs = (claim.data as LeadWhatsAppJob[]) ?? [];
      if (jobs.length === 0) break;
      for (const job of jobs) {
        out.claimed += 1;
        let result: Result;
        if (mode !== 'live' || !sender) {
          result = { outcome: 'DRY_RUN', detail: `Dry run - not sent: lead welcome to ${mask(job.to)}` };
        } else if (!job.template.approved || !job.template.name) {
          result = { outcome: 'SKIPPED', detail: 'The template is not approved, so nothing was sent.' };
        } else {
          try {
            result = await sender.send(job);
          } catch (err) {
            result = { outcome: 'RETRY', detail: `Could not send the message (${(err as Error).name || 'error'}).` };
          }
        }
        const fin = await db.rpc('lead_whatsapp_finish', { p_dispatch: job.id, p_outcome: result.outcome, p_detail: result.detail, p_response_code: result.code ?? null, p_ref: result.ref ?? null });
        if (fin.error) throw new Error(`lead_whatsapp_finish: ${fin.error.message}`);
        const status = (fin.data as { status: string }).status;
        if (status === 'DRY_RUN') out.dryRun += 1;
        else if (status === 'ACCEPTED') out.accepted += 1;
        else if (status === 'RETRY') out.retrying += 1;
        else if (status === 'SKIPPED') out.skipped += 1;
        else out.failed += 1;
      }
    }
  } catch (err) {
    out.error = (err as Error)?.message ?? 'unknown';
    console.error(JSON.stringify({ level: 'error', msg: 'lead whatsapp run failed', error: out.error }));
  }
  return out;
}

/**
 * Right after a lead is assigned: send its welcome message now (best effort; the scheduled dispatch is the safety net and sends the rest).
 * At most 3, so a large sheet upload does not keep the person waiting on Wabastore: a claimed batch is always finished (a message left
 * half-way would later be failed as "not recorded"), so the limit is what bounds the wait.
 */
export async function leadWhatsAppQuietly(): Promise<void> {
  if (leadWhatsAppMode() === 'off' || !hasServiceClient()) return;
  await runLeadWhatsApp({ limit: 3, budgetMs: 5_000 }).catch(() => undefined);
}

/** The provider's delivery report for a lead welcome message (ACCEPTED -> DELIVERED -> READ, or FAILED), matched by the message reference. */
export async function applyLeadDeliveryReport(ref: string, status: string, detail: string | null, db: SupabaseClient = getServiceClient()): Promise<{ matched: boolean }> {
  const r = await db.rpc('lead_whatsapp_status_update', { p_ref: ref, p_status: status.toUpperCase(), p_detail: detail });
  if (r.error) throw new Error(`lead_whatsapp_status_update: ${r.error.message}`);
  return { matched: Boolean((r.data as { matched: boolean }).matched) };
}

/**
 * The API routes whose success can give a lead its first sales person (a lead created by a seller, a lead assigned or reassigned, a sheet given
 * to telecallers or sellers, an inbound enquiry taken, imports). After one of them succeeds, the welcome messages it queued go out at once.
 */
const KICK_PATHS: RegExp[] = [
  /^\/pipeline\/leads(\/[^/]+)?$/,
  /^\/pipeline\/inbound\/[^/]+\/claim$/,
  /^\/pipeline\/customers\/[^/]+\/handover\/team-member$/,
  /^\/customers\/import$/,
  /^\/sales-head\/sheets$/,
  /^\/sales-head\/leads\/[^/]+\/assign$/,
  /^\/telecaller\/lists$/,
  /^\/telecaller\/leads(\/[^/]+)?$/,
  /^\/field-visits\/(assignments|lead-queue\/[^/]+\/assign)$/,
  /^\/ba\/leads(\/[^/]+)?$/,
  /^\/ba\/contacts\/[^/]+\/reassign$/,
  /^\/reassignment-queue\/[^/]+\/resolve$/
];

export function assignsLeads(method: string, path: string): boolean {
  return method !== 'GET' && KICK_PATHS.some(rx => rx.test(path));
}
