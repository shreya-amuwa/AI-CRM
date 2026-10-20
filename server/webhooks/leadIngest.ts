import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';
import { enforce } from '../http/rateLimit.js';

/**
 * Inbound lead webhook (WhatsApp / RCS / n8n / forms) -> public.crm_leads, written with the service role.
 *
 * Security:
 *  - Sender authentication: when WEBHOOK_SECRET (comma separated, >= 16 characters each) is set, every POST must send it as
 *    "X-Webhook-Secret: <secret>" or "Authorization: Bearer <secret>". Without it the endpoint stays open (so existing senders
 *    keep working until they are updated) and logs a warning - set WEBHOOK_SECRET and update the senders.
 *  - Only departments that exist can receive leads; department / source are slugs (no free text); every field is length limited;
 *    the stored raw payload is capped.
 *  - Per-address rate limit; rejected requests are written to the audit log (never the secret or the body).
 *  - No CORS headers (senders are servers, not browsers) and database error text is never returned.
 */
const MAX_RAW_BYTES = 64_000;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
let warnedOpen = false;

function configuredSecrets(): string[] {
  return (process.env.WEBHOOK_SECRET || '').split(',').map(s => s.trim()).filter(s => s.length >= 16);
}

function clientIp(req: VercelRequest): string {
  const real = req.headers['x-real-ip'];
  const fwd = req.headers['x-forwarded-for'];
  return (typeof real === 'string' && real) || (typeof fwd === 'string' && fwd.split(',')[0]?.trim()) || 'unknown';
}

function senderAuthorized(req: VercelRequest, secrets: string[]): boolean {
  const header = req.headers['x-webhook-secret'];
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
  const given = Buffer.from(String((Array.isArray(header) ? header[0] : header) || bearer || '').trim());
  return secrets.some(s => {
    const want = Buffer.from(s);
    return want.length === given.length && timingSafeEqual(want, given);
  });
}

/** Best effort: the audit entry must never turn a rejected request into a server error. */
async function audit(action: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    if (!hasServiceClient()) return;
    await getServiceClient().rpc('record_security_event', { p_action: action, p_entity_type: 'webhook', p_metadata: metadata });
  } catch {
    /* ignore */
  }
}

const clip = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

async function readBody(req: VercelRequest): Promise<unknown> {
  const raw: unknown = req.body;
  if (typeof raw === 'string') return JSON.parse(raw);
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString('utf-8'));
  if (raw && typeof raw === 'object') return raw;
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) {
    const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += b.length;
    if (size > 1_000_000) throw new Error('too large');
    buffers.push(b);
  }
  return buffers.length ? JSON.parse(Buffer.concat(buffers).toString('utf-8')) : null;
}

export async function ingestLead(req: VercelRequest, res: VercelResponse, target: { department?: string; source?: string }): Promise<unknown> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // Meta / WhatsApp subscription handshake and health check
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'] ?? req.query['hub_challenge'];
    if (challenge) {
      const expected = (process.env.WEBHOOK_VERIFY_TOKEN || '').trim();
      const token = req.query['hub.verify_token'] ?? req.query['hub_verify_token'];
      const value = String(Array.isArray(challenge) ? challenge[0] : challenge);
      if ((expected && String(Array.isArray(token) ? token[0] : token) !== expected) || !/^[A-Za-z0-9_.~-]{1,200}$/.test(value)) {
        return res.status(403).json({ error: 'Verification failed.' });
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(value);
    }
    return res.status(200).json({ status: 'active', message: 'Inbound Webhook Endpoint ready. Send HTTP POST with customer JSON.' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed. Please send an HTTP POST request.' });
  }

  const ip = clientIp(req);
  try {
    await enforce([{ key: `webhook:${ip}`, limit: 120, window: 60 }], 'shared');
  } catch (e) {
    if (e instanceof AppError && e.code === 'RATE_LIMITED') {
      const retry = (e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests.' });
    }
    throw e;
  }

  const department = clip(target.department || 'wabastore', 40).toLowerCase();
  const source = clip(target.source || 'whatsapp', 40).toLowerCase();

  const secrets = configuredSecrets();
  if (secrets.length) {
    if (!senderAuthorized(req, secrets)) {
      let allowed = true;
      try {
        await enforce([{ key: `webhook-audit:${ip}`, limit: 6, window: 60 }], 'shared');
      } catch {
        allowed = false;
      }
      if (allowed) await audit('WEBHOOK_REJECTED', { reason: 'bad_or_missing_secret', department, source, ip });
      return res.status(401).json({ error: 'Unauthorized.' });
    }
  } else if (!warnedOpen) {
    warnedOpen = true;
    console.warn('[webhook] WEBHOOK_SECRET is not set: the lead webhook accepts unauthenticated requests. Set it and update the senders.');
  }

  if (!SLUG.test(department) || !SLUG.test(source)) return res.status(400).json({ error: 'Invalid department or source.' });

  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid or missing JSON body' });

  // Unwrap array or { data: {...} } / { body: {...} }
  let item: any = body;
  if (Array.isArray(item)) item = item[0] || {};
  if (item && typeof item === 'object') {
    if (item.data && typeof item.data === 'object') item = Array.isArray(item.data) ? item.data[0] || {} : item.data;
    else if (item.body && typeof item.body === 'object') item = Array.isArray(item.body) ? item.body[0] || {} : item.body;
  }
  if (!item || typeof item !== 'object') item = {};

  const name = clip(item.name || item.customer_name || item.full_name || item.sender || item.rcs_sender, 200);
  const phone = clip(item.number || item.phone || item.contact || item.mobile || item.recipient_phone, 40);
  const email = clip(item.email, 254);
  const company = clip(item.store || item.company || item.organization, 200);
  const notes = clip(item.mssg || item.msg || item.message || item.notes || item.text || (typeof item.body === 'string' ? item.body : ''), 4000);

  if (!hasServiceClient()) return res.status(500).json({ error: 'Webhook storage is not configured.' });
  const db = getServiceClient();

  const { data: dept } = await db.from('departments').select('id').eq('slug', department).maybeSingle();
  if (!dept) return res.status(404).json({ error: 'Unknown department.' });

  const rawJson = JSON.stringify(body);
  const rawPayload = rawJson.length <= MAX_RAW_BYTES ? body : { truncated: true, bytes: rawJson.length };

  const { data, error } = await db
    .from('crm_leads')
    .insert([{
      name: name || 'Inbound Lead',
      phone: phone || null,
      email: email || null,
      company: company || null,
      notes: notes || null,
      channel: source,
      department,
      sub_department: 'support',
      status: 'New',
      raw_payload: rawPayload
    }])
    .select('id, name, phone, email, company, channel, department, status, created_at');

  if (error) {
    console.error('[webhook] could not store the lead', { code: error.code });
    return res.status(500).json({ error: 'Could not store the lead.' });
  }
  return res.status(200).json({ success: true, message: 'Lead received and added to Support Queue', lead: data?.[0] ?? null });
}
