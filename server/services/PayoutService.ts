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
export async function settleRazorpayPayout(payoutId: string, status: string, utr: string | null, reason: string | null, eventId: string | null) {
  return svcRpc<{ matched: boolean; ignored?: boolean; status?: string }>('payout_rzp_settle',
    { p_payout: payoutId, p_status: status, p_utr: utr, p_reason: reason, p_event_id: eventId });
}

/** The safety net for missed webhooks: ask Razorpay about payouts still being sent after 10 minutes. Never throws. */
export async function checkPendingRazorpayPayouts(): Promise<{ checked: number; settled: number } | { skipped: string }> {
  const cfg = razorpayXConfig();
  if (!cfg) return { skipped: 'Razorpay is not set up.' };
  if (!hasServiceClient()) return { skipped: 'The server has no service key.' };
  const client = new RazorpayXClient(cfg);
  let checked = 0, settled = 0;
  try {
    const pending = await svcRpc<{ id: string; payoutId: string }[]>('payout_rzp_pending', { p_minutes: 10 });
    for (const p of pending) {
      checked++;
      try {
        const rp = await client.getPayout(p.payoutId);
        const r = await settleRazorpayPayout(rp.id, rp.status, rp.utr ?? null, rp.status_details?.description ?? null, null);
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
    let payout;
    try {
      let fundAccountId = begun.fundAccountId;
      if (!fundAccountId) {
        const contactId = begun.contactId ?? (await client.createContact({ name: begun.name || begun.method.holderName, email: begun.email, contact: begun.phone, referenceId: begun.profileId })).id;
        const m: RzpMethod = begun.method.kind === 'BANK'
          ? { kind: 'BANK', holderName: begun.method.holderName, accountNumber: String(begun.method.accountNumber), ifsc: String(begun.method.ifsc) }
          : { kind: 'UPI', holderName: begun.method.holderName, upiId: String(begun.method.upiId) };
        fundAccountId = (await client.createFundAccount(contactId, m)).id;
        await svcRpc('payout_rzp_link', { p_profile: begun.profileId, p_contact: contactId, p_fund: fundAccountId });
      }
      const amountPaise = toPaise(begun.netAmount);
      // the request id is the idempotency key: pressing again, or a retry after a lost answer, never makes a second payout
      payout = await client.createPayout({
        fundAccountId, amountPaise, mode: begun.method.kind === 'UPI' ? 'UPI' : amountPaise <= 50_000_000 ? 'IMPS' : 'NEFT',
        referenceId: requestId.replace(/-/g, ''), idempotencyKey: requestId
      });
    } catch (e) {
      const why = e instanceof RazorpayXError ? e.description : 'Razorpay could not be reached.';
      await svcRpc('payout_rzp_undo', { p_id: requestId, p_reason: why }).catch(() => undefined);
      throw new AppError('VALIDATION_ERROR', `Razorpay did not send it: ${why} The withdrawal is waiting again.`);
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
    const row = await svcRpc<{ status: string; payoutId: string | null } | null>('payout_rzp_lookup', { p_id: requestId });
    if (!row?.payoutId) throw new AppError('CONFLICT', 'This withdrawal was not sent through Razorpay.');
    const rp = await new RazorpayXClient(cfg).getPayout(row.payoutId).catch(e => {
      throw new AppError('SERVICE_UNAVAILABLE', e instanceof RazorpayXError ? `Razorpay: ${e.description}` : 'Razorpay could not be reached.');
    });
    const settled = await settleRazorpayPayout(rp.id, rp.status, rp.utr ?? null, rp.status_details?.description ?? null, null);
    return { id: requestId, status: settled.status ?? row.status, razorpayStatus: rp.status };
  }
}

/** The RazorpayX webhook (signed; no session): payout.processed / reversed / failed / rejected settle the request. */
export async function handleRazorpayWebhook(rawBody: string, signature: string | undefined, eventId: string | undefined) {
  const cfg = razorpayXConfig();
  if (!cfg) throw new AppError('SERVICE_UNAVAILABLE', 'Razorpay is not set up.');
  if (!verifyRazorpaySignature(rawBody, signature, cfg.webhookSecret)) throw new AppError('UNAUTHENTICATED');
  if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'The server has no service key.');
  let body: { event?: string; payload?: { payout?: { entity?: { id?: string; status?: string; utr?: string | null; status_details?: { description?: string | null } } } } };
  try { body = JSON.parse(rawBody); } catch { throw new AppError('VALIDATION_ERROR', 'The event is not valid JSON.'); }
  const p = body.payload?.payout?.entity;
  if (!String(body.event || '').startsWith('payout.') || !p?.id || !p.status) return { matched: false, ignored: true };
  return settleRazorpayPayout(p.id, p.status, p.utr ?? null, p.status_details?.description ?? null, eventId?.slice(0, 120) || `${body.event}:${p.id}:${p.status}`);
}
