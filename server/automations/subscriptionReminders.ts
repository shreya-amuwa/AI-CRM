import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';

/**
 * Subscription expiry reminder calls (7, 3 and 1 day before a service expires).
 *
 * The database decides WHAT is due and keeps one row per customer, service, expiry date and stage under a unique key
 * (sub_reminder_schedule), re-checks eligibility the moment a reminder is claimed (renewed, cancelled, no consent, no mobile,
 * window closed) and records every attempt. This module only drives that queue.
 *
 * AUTOMATION_MODE_AI_CALL:
 *   off      nothing happens.
 *   dry_run  (default) reminders are decided and logged as "would call"; nobody is called, nothing leaves the server.
 *   live     calls are placed through the calling provider (BolifyAI, see bolify.ts). Without BOLIFY_WEBHOOK_URL there is no provider, so live
 *            behaves like "off" and says so: nobody is called.
 */
export type AiCallMode = 'off' | 'dry_run' | 'live';

export interface ReminderRunSummary {
  mode: AiCallMode;
  schedule: { day: string; created: number; cancelled: number } | null;
  claimed: number;
  dryRun: number;
  accepted: number;
  retrying: number;
  failed: number;
  skipped: number;
  note?: string;
  error?: string;
}

/** What the database hands over for one call: only what is needed to place it. */
export interface ReminderCall {
  id: string;
  attempts: number;
  stage: 7 | 3 | 1;
  expiryDate: string;
  daysLeft: number;
  phone: string;
  customerId: string;
  firstName: string;
  lastName: string;
  company: string | null;
  email: string | null;
  location: string | null;
  serviceCode: string;
  serviceName: string | null;
  planName: string | null;
}

/** A calling provider (BolifyAI: bolify.ts). SKIPPED is for a call the provider layer chose not to place (for example a staging allow-list). */
export interface ReminderCallSender {
  place(call: ReminderCall): Promise<{ outcome: 'ACCEPTED' | 'RETRY' | 'FAILED' | 'SKIPPED'; detail: string; code?: number | null; callId?: string | null }>;
}

export function aiCallMode(env: NodeJS.ProcessEnv = process.env): AiCallMode {
  const v = (env.AUTOMATION_MODE_AI_CALL || 'dry_run').trim().toLowerCase();
  return v === 'live' || v === 'off' ? v : 'dry_run';
}

const maskPhone = (p: string) => (p.length > 4 ? `${p.slice(0, 3)}XXXXXX${p.slice(-4)}` : 'XXXX');

/** The scheduler tick. Never throws (it runs inside the dispatch request, next to the other automations). */
export async function runSubscriptionReminders(
  opts: { db?: SupabaseClient; today?: string; limit?: number; sender?: ReminderCallSender | null } = {}
): Promise<ReminderRunSummary> {
  const mode = aiCallMode();
  const out: ReminderRunSummary = { mode, schedule: null, claimed: 0, dryRun: 0, accepted: 0, retrying: 0, failed: 0, skipped: 0 };
  if (mode === 'off') return { ...out, note: 'Reminder calls are switched off (AUTOMATION_MODE_AI_CALL=off).' };
  if (!opts.db && !hasServiceClient()) return { ...out, note: 'The server has no service key.' };
  if (mode === 'live' && !opts.sender) {
    return { ...out, mode: 'off', note: 'Live calling is not available: no calling provider is connected (set BOLIFY_WEBHOOK_URL). Nothing was scheduled or called.' };
  }
  const db = opts.db ?? getServiceClient();
  try {
    const sched = await db.rpc('sub_reminder_schedule', { p_today: opts.today ?? null });
    if (sched.error) throw new Error(`sub_reminder_schedule: ${sched.error.message}`);
    out.schedule = sched.data as ReminderRunSummary['schedule'];

    const limit = opts.limit ?? 20;
    while (out.claimed < limit) {
      const claim = await db.rpc('sub_reminder_claim', { p_limit: Math.min(5, limit - out.claimed), p_mode: mode });
      if (claim.error) throw new Error(`sub_reminder_claim: ${claim.error.message}`);
      const calls = (claim.data as ReminderCall[]) ?? [];
      if (calls.length === 0) break;
      for (const call of calls) {
        out.claimed += 1;
        let result: { outcome: 'DRY_RUN' | 'ACCEPTED' | 'RETRY' | 'FAILED' | 'SKIPPED'; detail: string; code?: number | null; callId?: string | null };
        if (mode !== 'live' || !opts.sender) {
          result = {
            outcome: 'DRY_RUN',
            detail: `Dry run - not called: ${call.serviceName ?? call.serviceCode} expires ${call.expiryDate} (${call.daysLeft} day${call.daysLeft === 1 ? '' : 's'}), ${maskPhone(call.phone)}`
          };
        } else {
          try {
            result = await opts.sender.place(call);
          } catch (err) {
            result = { outcome: 'RETRY', detail: `Could not reach the calling service (${(err as Error).name || 'error'}).` };
          }
        }
        const fin = await db.rpc('sub_reminder_finish', {
          p_reminder: call.id, p_outcome: result.outcome, p_detail: result.detail, p_response_code: result.code ?? null, p_call_id: result.callId ?? null
        });
        if (fin.error) throw new Error(`sub_reminder_finish: ${fin.error.message}`);
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
    console.error(JSON.stringify({ level: 'error', msg: 'subscription reminder run failed', error: out.error }));
  }
  return out;
}
