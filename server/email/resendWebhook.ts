import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { hookKey, verifyHookSignature } from '../automations/authEmailHook.js';

/**
 * Resend webhooks (docs/EMAIL_MANAGEMENT.md, "Delivery events"): delivered, delayed, bounced, complained, failed. Resend signs every request
 * with Svix: HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>" with the endpoint's signing secret (whsec_...), the same Standard
 * Webhooks scheme as the Supabase auth hook, so the same checked verifier is used: the raw body exactly as received, the timestamp within
 * 5 minutes. An unsigned or wrongly signed request changes nothing. Each event is stored once by its svix-id (a redelivery is a no-op),
 * and a hard bounce or a complaint suppresses the address for every provider. Only the event type, ids, time and the recipient address
 * (for suppression) are used; the e-mail's content is never read.
 */
export const RESEND_WEBHOOK_MAX_BYTES = 256_000;
const HANDLED = new Set(['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed']);

export interface WebhookReply { status: number; body: Record<string, unknown> }
export interface ResendWebhookDeps {
  secret: () => string | undefined;
  now: () => number;
  record: (event: Record<string, unknown>) => Promise<{ duplicate: boolean; matched: boolean }>;
}

const defaults: ResendWebhookDeps = {
  secret: () => process.env.RESEND_WEBHOOK_SECRET,
  now: Date.now,
  async record(event) {
    if (!hasServiceClient()) throw new Error('no service client');
    const { data, error } = await getServiceClient().rpc('email_provider_event', { p: event });
    if (error) throw new Error(error.message);
    return data as { duplicate: boolean; matched: boolean };
  }
};

export async function handleResendWebhook(req: { body: string; id?: string; timestamp?: string; signature?: string }, deps: Partial<ResendWebhookDeps> = {}): Promise<WebhookReply> {
  const d = { ...defaults, ...deps };
  const key = hookKey(d.secret());
  if (!key) return { status: 503, body: { error: 'The Resend webhook is not configured on the server.' } };
  if (Buffer.byteLength(req.body) > RESEND_WEBHOOK_MAX_BYTES) return { status: 413, body: { error: 'Too large.' } };
  if (!req.id || !req.timestamp || !req.signature) return { status: 400, body: { error: 'Missing signature headers.' } };
  if (!verifyHookSignature(key, req, req.body, d.now())) return { status: 401, body: { error: 'The signature is not valid.' } };
  let payload: { type?: unknown; created_at?: unknown; data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown } } };
  try {
    payload = JSON.parse(req.body);
  } catch {
    return { status: 400, body: { error: 'Not JSON.' } };
  }
  const type = typeof payload.type === 'string' ? payload.type : '';
  // opened / clicked and any future event: acknowledged, not stored (the CRM does not track opens)
  if (!HANDLED.has(type)) return { status: 200, body: { ignored: true } };
  const to = Array.isArray(payload.data?.to) ? payload.data!.to.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  try {
    const r = await d.record({
      provider: 'resend', eventId: req.id, type,
      providerMessageId: typeof payload.data?.email_id === 'string' ? payload.data.email_id : null,
      occurredAt: typeof payload.created_at === 'string' ? payload.created_at : null,
      recipients: to,
      bounceType: typeof payload.data?.bounce?.type === 'string' ? payload.data.bounce.type : null
    });
    return { status: 200, body: { ok: true, duplicate: r.duplicate } };
  } catch (err) {
    // Resend retries a failed delivery: answer 5xx so the event is not lost; nothing personal is logged
    console.error(JSON.stringify({ level: 'error', msg: 'resend webhook: could not record the event', type, error: (err instanceof Error ? err.message : 'error').slice(0, 120) }));
    return { status: 503, body: { error: 'Could not record the event.' } };
  }
}
