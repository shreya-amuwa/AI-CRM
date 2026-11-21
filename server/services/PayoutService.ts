import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { uuidSchema } from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { RazorpayXClient, RazorpayXError, razorpayXConfig, toPaise, verifyRazorpaySignature, type RzpMethod } from '../payouts/razorpayx.js';
import type { PayoutRepository } from '../repositories/PayoutRepository.js';

// pdf-lib is loaded only when a slip is actually drawn
const slipPdf = () => import('../payouts/slip.js');
const tdsBody = z.object({ tds: z.coerce.number().min(0).max(10_000_000).default(0) });

/** The database functions behind a Razorpay payout (service role only: the caller's session was checked first). */
async function svcRpc<T>(name: string, args: Record<string, unknown>, db: SupabaseClient = getServiceClient()): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const m = /^(FORBIDDEN|NOT_FOUND|CONFLICT|VALIDATION_ERROR): (.+)$/s.exec(error.message);
    if (m) throw new AppError(m[1] as 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR', m[2]);
    throw new AppError('SERVICE_UNAVAILABLE', 'The payout could not be recorded.');
  }
  return data as T;
}

/** Settle a request from a Razorpay status (webhook or status check). */
export async function settleRazorpayPayout(payoutId: string, status: string, utr: string | null, reason: string | null, eventId: string | null, reference: string | null = null) {
  return svcRpc<{ matched: boolean; ignored?: boolean; status?: string }>('payout_rzp_settle',
    { p_payout: payoutId, p_status: status, p_utr: utr, p_reason: reason, p_event_id: eventId, p_reference: reference });
}

/** Razorpay refused (a 4xx): nothing was sent. A timeout, a network error or a 5xx means it is not known whether Razorpay made the payout. */
const definitelyRefused = (e: unknown) => e instanceof RazorpayXError && e.status >= 400 && e.status < 500;
const referenceOf = (requestId: string) => requestId.replace(/-/g, '');

interface PendingRow { id: string; payoutId: string | null; rzpStatus: string | null; fundAccountId: string | null; amountPaise: number | null; mode: 'IMPS' | 'NEFT' | 'UPI' | null }

/**
 * Bring a withdrawal being sent up to date: ask Razorpay about its payout; if the answer to the payout call was lost, send the same payout
 * again with the same idempotency key (Razorpay gives back the one it made, or makes it now - never two); if the payout call was never made
 * (the server stopped before it), put the request back to waiting.
 */
async function recoverRazorpayPayout(client: RazorpayXClient, row: PendingRow): Promise<{ status?: string; razorpayStatus: string }> {
  if (row.payoutId) {
    const rp = await client.getPayout(row.payoutId);
    const r = await settleRazorpayPayout(rp.id, rp.status, rp.utr ?? null, rp.status_details?.description ?? null, null);
    return { status: r.status, razorpayStatus: rp.status };
  }
  if (row.rzpStatus === 'sending' && row.fundAccountId && row.amountPaise && row.mode) {
    let rp;
    try {
      // exactly what was sent the first time (same key, fund account, amount and mode)
      rp = await client.createPayout({ fundAccountId: row.fundAccountId, amountPaise: Number(row.amountPaise), mode: row.mode, referenceId: referenceOf(row.id), idempotencyKey: row.id });
    } catch (e) {
      if (definitelyRefused(e)) {
        await svcRpc('payout_rzp_undo', { p_id: row.id, p_reason: (e as RazorpayXError).description });
        return { status: 'REQUESTED', razorpayStatus: 'refused' };
      }
      throw e;
    }
    await svcRpc('payout_rzp_set_id', { p_id: row.id, p_payout: rp.id });
    const r = await settleRazorpayPayout(rp.id, rp.status, rp.utr ?? null, rp.status_details?.description ?? null, null);
    return { status: r.status, razorpayStatus: rp.status };
  }
  // the payout call was never made: safe to wait again
  await svcRpc('payout_rzp_undo', { p_id: row.id, p_reason: 'The payout was not sent (the server stopped before it).' });
  return { status: 'REQUESTED', razorpayStatus: 'not sent' };
}

/** The safety net for missed webhooks and lost answers: withdrawals being sent for 10+ minutes. At most `budgetMs`; never throws. */
export async function checkPendingRazorpayPayouts(budgetMs = 12_000): Promise<{ checked: number; settled: number } | { skipped: string }> {
  const cfg = razorpayXConfig();
  if (!cfg) return { skipped: 'Razorpay is not set up.' };
  if (!hasServiceClient()) return { skipped: 'The server has no service key.' };
  const client = new RazorpayXClient(cfg);
  const deadline = Date.now() + budgetMs;
  let checked = 0, settled = 0;
  try {
    const pending = await svcRpc<PendingRow[]>('payout_rzp_pending', { p_minutes: 10 });
    for (const row of pending) {
      if (Date.now() > deadline) break;
      checked++;
      try {
        const r = await recoverRazorpayPayout(client, row);
        if (r.status && r.status !== 'PROCESSING') settled++;
      } catch { /* next one; the next run tries again */ }
    }
  } catch { /* nothing to do this time */ }
  return { checked, settled };
}

/** Incentive payouts: the payout slip, and paying through RazorpayX (Accounts; the database checks and records every step). */
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async slip(id: string): Promise<{ fileName: string; contentBase64: string }> {
    const data = await this.repo.slipData(parse(uuidSchema, id));
    const bytes = await (await slipPdf()).renderPayoutSlip(data);
    return { fileName: `Payout-${data.slipNo}.pdf`, contentBase64: Buffer.from(bytes).toString('base64') };
  }

  razorpayStatus(): { configured: boolean } {
    return { configured: !!razorpayXConfig() && hasServiceClient() };
  }

  /** Send a withdrawal through RazorpayX: net = amount - TDS, to the details given with the request. */
  async payViaRazorpay(actor: Actor, id: string, body: unknown) {
    const requestId = parse(uuidSchema, id);
    const { tds } = parse(tdsBody, body ?? {});
    const cfg = razorpayXConfig();
    if (!cfg || !hasServiceClient()) throw new AppError('CONFLICT', 'Razorpay is not set up. Pay this withdrawal by hand, or add the RazorpayX settings.');
    await this.repo.detail(requestId);   // FORBIDDEN for anyone outside Accounts, before anything is sent
    const begun = await svcRpc<{
      id: string; profileId: string; name: string; netAmount: number; email: string | null; phone: string | null;
      contactId: string | null; fundAccountId: string | null; method: { kind: string; holderName: string; accountNumber?: string; ifsc?: string; upiId?: string };
    }>('payout_rzp_begin', { p_id: requestId, p_actor: actor.id, p_tds: tds });
    const client = new RazorpayXClient(cfg);
    let fundAccountId = begun.fundAccountId;
    const amountPaise = toPaise(begun.netAmount);
    const mode = begun.method.kind === 'UPI' ? 'UPI' as const : amountPaise <= 50_000_000 ? 'IMPS' as const : 'NEFT' as const;
    // before the payout call nothing can have been paid: any problem puts the request back to waiting
    try {
      if (!fundAccountId) {
        const contactId = begun.contactId ?? (await client.createContact({ name: begun.name || begun.method.holderName, email: begun.email, contact: begun.phone, referenceId: begun.profileId })).id;
        const m: RzpMethod = begun.method.kind === 'BANK'
          ? { kind: 'BANK', holderName: begun.method.holderName, accountNumber: String(begun.method.accountNumber), ifsc: String(begun.method.ifsc) }
          : { kind: 'UPI', holderName: begun.method.holderName, upiId: String(begun.method.upiId) };
        fundAccountId = (await client.createFundAccount(contactId, m)).id;
        await svcRpc('payout_rzp_link', { p_id: requestId, p_contact: contactId, p_fund: fundAccountId });
      }
      await svcRpc('payout_rzp_prepare', { p_id: requestId, p_fund: fundAccountId, p_paise: amountPaise, p_mode: mode });
    } catch (e) {
      const why = e instanceof RazorpayXError ? e.description : e instanceof AppError ? e.message : 'Razorpay could not be reached.';
      await svcRpc('payout_rzp_undo', { p_id: requestId, p_reason: why }).catch(() => undefined);
      throw new AppError('VALIDATION_ERROR', `Razorpay did not send it: ${why} The withdrawal is waiting again.`);
    }
    // the payout call: the request id is the idempotency key, so a retry never makes a second payout
    let payout;
    try {
      payout = await client.createPayout({ fundAccountId: fundAccountId!, amountPaise, mode, referenceId: referenceOf(requestId), idempotencyKey: requestId });
    } catch (e) {
      if (definitelyRefused(e)) {
        await svcRpc('payout_rzp_undo', { p_id: requestId, p_reason: (e as RazorpayXError).description }).catch(() => undefined);
        throw new AppError('VALIDATION_ERROR', `Razorpay did not send it: ${(e as RazorpayXError).description} The withdrawal is waiting again.`);
      }
      // no answer: Razorpay may have made the payout. It stays "being sent" (it cannot be paid by hand) until the status check finds out.
      return { id: requestId, status: 'PROCESSING', razorpayStatus: 'unknown',
               note: 'Razorpay did not answer in time. The CRM checks again in a few minutes; use Check status to ask now. Do not pay it by hand.' };
    }
    await svcRpc('payout_rzp_set_id', { p_id: requestId, p_payout: payout.id });
    const settled = await settleRazorpayPayout(payout.id, payout.status, payout.utr ?? null, payout.status_details?.description ?? null, null);
    return { id: requestId, status: settled.status ?? 'PROCESSING', razorpayStatus: payout.status };
  }

  /** Check status: ask Razorpay about a withdrawal still being sent (for a missed webhook). */
  async checkRazorpay(id: string) {
    const requestId = parse(uuidSchema, id);
    const cfg = razorpayXConfig();
    if (!cfg || !hasServiceClient()) throw new AppError('CONFLICT', 'Razorpay is not set up.');
    await this.repo.detail(requestId);   // Accounts only
    const row = await svcRpc<(PendingRow & { status: string; channel: string | null }) | null>('payout_rzp_lookup', { p_id: requestId });
    if (!row || row.status !== 'PROCESSING' || row.channel !== 'RAZORPAY') throw new AppError('CONFLICT', 'This withdrawal is not being sent through Razorpay.');
    try {
      const r = await recoverRazorpayPayout(new RazorpayXClient(cfg), row);
      return { id: requestId, status: r.status ?? row.status, razorpayStatus: r.razorpayStatus };
    } catch (e) {
      throw new AppError('SERVICE_UNAVAILABLE', e instanceof RazorpayXError ? `Razorpay: ${e.description}` : 'Razorpay could not be reached. Try again in a few minutes.');
    }
  }
}

/** The RazorpayX webhook (signed; no session): payout.processed / reversed / failed / rejected settle the request. */
export async function handleRazorpayWebhook(rawBody: string, signature: string | undefined, eventId: string | undefined) {
  const cfg = razorpayXConfig();
  if (!cfg) throw new AppError('SERVICE_UNAVAILABLE', 'Razorpay is not set up.');
  if (!verifyRazorpaySignature(rawBody, signature, cfg.webhookSecret)) throw new AppError('UNAUTHENTICATED');
  if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'The server has no service key.');
  let body: { event?: string; payload?: { payout?: { entity?: { id?: string; status?: string; utr?: string | null; reference_id?: string | null; status_details?: { description?: string | null } } } } };
  try { body = JSON.parse(rawBody); } catch { throw new AppError('VALIDATION_ERROR', 'The event is not valid JSON.'); }
  const p = body.payload?.payout?.entity;
  if (!String(body.event || '').startsWith('payout.') || !p?.id || !p.status) return { matched: false, ignored: true };
  // deduplicated on the signed payout id and status (not the unsigned event-id header): a retried or replayed event changes nothing twice
  void eventId;
  return settleRazorpayPayout(p.id, p.status, p.utr ?? null, p.status_details?.description ?? null, `${p.id}:${p.status}`, p.reference_id ?? null);
}
