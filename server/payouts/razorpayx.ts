import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * RazorpayX Payouts (migration 20270125000100): contacts, fund accounts, payouts and their status. The keys are server settings only
 * (RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET, RAZORPAYX_ACCOUNT_NUMBER, RAZORPAYX_WEBHOOK_SECRET); without all four nothing is sent.
 * RAZORPAYX_BASE_URL is for the tests' stand-in only.
 */
export interface RazorpayXConfig { keyId: string; keySecret: string; accountNumber: string; webhookSecret: string; baseUrl: string }

export function razorpayXConfig(env: NodeJS.ProcessEnv = process.env): RazorpayXConfig | null {
  const keyId = (env.RAZORPAYX_KEY_ID || '').trim();
  const keySecret = (env.RAZORPAYX_KEY_SECRET || '').trim();
  const accountNumber = (env.RAZORPAYX_ACCOUNT_NUMBER || '').trim();
  const webhookSecret = (env.RAZORPAYX_WEBHOOK_SECRET || '').trim();
  if (!keyId || !keySecret || !accountNumber || webhookSecret.length < 16) return null;
  return { keyId, keySecret, accountNumber, webhookSecret, baseUrl: (env.RAZORPAYX_BASE_URL || 'https://api.razorpay.com/v1').trim().replace(/\/+$/, '') };
}

/** Razorpay answered with an error (it did not do what was asked); `status` is the HTTP status, `description` Razorpay's own words. */
export class RazorpayXError extends Error {
  constructor(public readonly status: number, public readonly description: string) {
    super(description);
  }
}

export interface RzpPayout { id: string; status: string; utr?: string | null; status_details?: { description?: string | null } | null }
export type RzpMethod = { kind: 'BANK'; holderName: string; accountNumber: string; ifsc: string } | { kind: 'UPI'; holderName: string; upiId: string };

export class RazorpayXClient {
  constructor(private readonly cfg: RazorpayXConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64')}`,
        'content-type': 'application/json', ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
    if (!res.ok) throw new RazorpayXError(res.status, (json.error?.description || `Razorpay answered ${res.status}.`).slice(0, 300));
    return json;
  }

  createContact(c: { name: string; email?: string | null; contact?: string | null; referenceId: string }) {
    return this.call<{ id: string }>('POST', '/contacts', {
      name: c.name.slice(0, 50), email: c.email || undefined, contact: c.contact || undefined, type: 'employee', reference_id: c.referenceId.slice(0, 40)
    });
  }

  createFundAccount(contactId: string, m: RzpMethod) {
    return this.call<{ id: string }>('POST', '/fund_accounts', m.kind === 'BANK'
      ? { contact_id: contactId, account_type: 'bank_account', bank_account: { name: m.holderName.slice(0, 120), ifsc: m.ifsc, account_number: m.accountNumber } }
      : { contact_id: contactId, account_type: 'vpa', vpa: { address: m.upiId } });
  }

  /** One payout per idempotency key: a retry with the same key returns the same payout (Razorpay's X-Payout-Idempotency). */
  createPayout(p: { fundAccountId: string; amountPaise: number; mode: 'IMPS' | 'NEFT' | 'UPI'; referenceId: string; idempotencyKey: string }) {
    return this.call<RzpPayout>('POST', '/payouts', {
      account_number: this.cfg.accountNumber, fund_account_id: p.fundAccountId, amount: p.amountPaise, currency: 'INR', mode: p.mode,
      purpose: 'payout', queue_if_low_balance: true, reference_id: p.referenceId.slice(0, 40), narration: 'Amuwa incentive'
    }, { 'X-Payout-Idempotency': p.idempotencyKey });
  }

  getPayout(id: string) {
    return this.call<RzpPayout>('GET', `/payouts/${encodeURIComponent(id)}`);
  }
}

/** The webhook's X-Razorpay-Signature: HMAC-SHA256 of the raw body with the webhook secret, hex. */
export function verifyRazorpaySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature.trim());
  return want.length === given.length && timingSafeEqual(want, given);
}

/** Rupees with paise -> integer paise (1,184.25 -> 118425). */
export const toPaise = (rupees: number) => Math.round(Number(rupees) * 100);
