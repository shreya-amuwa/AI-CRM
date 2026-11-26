import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { automationSettings, senderSettings, type AutomationSettings } from './config.js';
import { sendEmail, type SendResult } from './providers.js';
import { enforce } from '../http/rateLimit.js';
import { AppError } from '../http/errors.js';
import { limitOf } from '../security/abuse.js';
import type { RenderedEmail } from './templates.js';
import { linkLifetimeText } from '../security/linkLifetime.js';

/**
 * Supabase "Send Email" auth hook: Supabase does not send its sign-up / password-reset / invite e-mails itself, it POSTs them here and
 * the CRM sends them through its own mail setup (nodemailer over SMTP, Resend or Brevo). The request is signed with the hook secret
 * (Standard Webhooks: HMAC-SHA256 over "<webhook-id>.<webhook-timestamp>.<body>"), so nobody else can make the CRM send a link.
 *
 * Applies to EVERY auth e-mail of the Supabase project (candidates, employees, clients), so every e-mail type is handled, and the
 * wording follows who the user is (candidates are told it is the careers portal).
 */

export const HOOK_TOLERANCE_SECONDS = 5 * 60;
export const HOOK_MAX_BODY_BYTES = 20_000;

/** The pieces of Supabase's hook request that are used. Anything else in the body is ignored. */
const hookSchema = z.object({
  user: z.object({
    email: z.string().trim().email().max(320),
    new_email: z.string().trim().email().max(320).optional().nullable(),
    user_metadata: z.record(z.string(), z.unknown()).optional().nullable()
  }),
  email_data: z.object({
    token: z.string().max(64).default(''),
    token_hash: z.string().max(256).default(''),
    redirect_to: z.string().max(2048).default(''),
    email_action_type: z.string().max(40)
  })
});
export type AuthHookPayload = z.infer<typeof hookSchema>;

export interface HookReply {
  status: number;
  /** Supabase wants `{}` on success and `{ error: { http_code, message } }` otherwise. */
  body: Record<string, unknown>;
}

const fail = (status: number, message: string): HookReply => ({ status, body: { error: { http_code: status, message } } });

// ---------------------------------------------------------------------------
// Signature (Standard Webhooks)
// ---------------------------------------------------------------------------
/** The secret as Supabase shows it: "v1,whsec_<base64>". Returns the key bytes, or null when it is missing or unusable. */
export function hookKey(raw: string | undefined): Buffer | null {
  const v = (raw ?? '').trim().replace(/^v1,/, '').replace(/^whsec_/, '');
  if (!v) return null;
  const key = Buffer.from(v, 'base64');
  return key.length >= 16 ? key : null;
}

export function signHook(key: Buffer, id: string, timestamp: string, body: string): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export function verifyHookSignature(
  key: Buffer,
  headers: { id?: string; timestamp?: string; signature?: string },
  body: string,
  nowMs: number = Date.now()
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowMs / 1000 - ts) > HOOK_TOLERANCE_SECONDS) return false;
  const want = Buffer.from(signHook(key, id, timestamp, body));
  // the header may carry several signatures ("v1,xxx v1,yyy"); any valid one is enough
  return signature.split(' ').some(part => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

// ---------------------------------------------------------------------------
// The e-mails
// ---------------------------------------------------------------------------
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type AuthAudience = 'CANDIDATE' | 'STAFF';

export function audienceOf(user: AuthHookPayload['user']): AuthAudience {
  return user.user_metadata?.candidate_portal === true ? 'CANDIDATE' : 'STAFF';
}

function displayName(user: AuthHookPayload['user']): string {
  const m = user.user_metadata ?? {};
  const given = [m.name, m.full_name].find(v => typeof v === 'string' && v.trim());
  return (typeof given === 'string' ? given.trim().slice(0, 80) : '') || user.email.split('@')[0];
}

/** The link that confirms the action: Supabase's own verify endpoint, which then sends the person on to `redirect_to`. */
export function verifyUrl(data: AuthHookPayload['email_data'], supabaseUrl: string): string {
  const u = new URL('/auth/v1/verify', supabaseUrl);
  u.searchParams.set('token', data.token_hash);
  u.searchParams.set('type', data.email_action_type);
  if (/^https?:\/\//i.test(data.redirect_to)) u.searchParams.set('redirect_to', data.redirect_to);
  return u.toString();
}

interface Copy {
  subject: string;
  heading: string;
  intro: string;
  button?: string;
  code?: boolean;
  outro: string;
}

function copyFor(type: string, audience: AuthAudience): Copy | null {
  const place = audience === 'CANDIDATE' ? 'the Amuwa Corporation careers portal' : 'the Amuwa CRM';
  switch (type) {
    case 'signup':
      return {
        subject: audience === 'CANDIDATE' ? 'Confirm your email – Amuwa Careers' : 'Confirm your email – Amuwa CRM',
        heading: 'Confirm your email address',
        intro: `Thanks for signing up for ${place}. Confirm your email address to finish creating your account.`,
        button: 'Confirm email address',
        outro: 'If you did not sign up, you can ignore this email.'
      };
    case 'recovery':
      return {
        subject: audience === 'CANDIDATE' ? 'Reset your password – Amuwa Careers' : 'Reset your password – Amuwa CRM',
        heading: 'Reset your password',
        intro: `We received a request to reset the password of your account on ${place}. Use the button below to choose a new one. ${linkLifetimeText()}`,
        button: 'Choose a new password',
        outro: 'If you did not ask for this, ignore this email: your password stays as it is.'
      };
    case 'invite':
      return {
        subject: `You have been invited to ${audience === 'CANDIDATE' ? 'Amuwa Careers' : 'the Amuwa CRM'}`,
        heading: 'You have been invited',
        intro: `You have been invited to ${place}. Accept the invitation to set up your account.`,
        button: 'Accept the invitation',
        outro: 'If you were not expecting this invitation, you can ignore this email.'
      };
    case 'magiclink':
      return {
        subject: audience === 'CANDIDATE' ? 'Your sign-in link – Amuwa Careers' : 'Your sign-in link – Amuwa CRM',
        heading: 'Sign in',
        intro: `Use the button below to sign in to ${place}. ${linkLifetimeText()}`,
        button: 'Sign in',
        outro: 'If you did not ask for this, you can ignore this email.'
      };
    case 'email':
    case 'reauthentication':
      return {
        subject: `Your verification code – ${audience === 'CANDIDATE' ? 'Amuwa Careers' : 'Amuwa CRM'}`,
        heading: 'Your verification code',
        intro: `Enter this code on ${place}. It expires soon, and nobody from Amuwa will ever ask you for it.`,
        code: true,
        outro: 'If you did not ask for this, you can ignore this email.'
      };
    default:
      return null;
  }
}

/** The e-mail for one hook request, or null when this e-mail type is not supported. */
export function renderAuthEmail(payload: AuthHookPayload, supabaseUrl: string): (RenderedEmail & { brand: string }) | null {
  const audience = audienceOf(payload.user);
  const copy = copyFor(payload.email_data.email_action_type, audience);
  if (!copy) return null;
  const brand = audience === 'CANDIDATE' ? 'Amuwa Careers' : 'Amuwa CRM';
  const name = displayName(payload.user);
  const link = copy.code ? '' : verifyUrl(payload.email_data, supabaseUrl);
  if (copy.code && !payload.email_data.token) return null;

  const action = copy.code
    ? `<p style="margin:18px 0;font-size:28px;letter-spacing:6px;font-weight:700;color:#0f1d3a">${esc(payload.email_data.token)}</p>`
    : `<p style="margin:18px 0"><a href="${esc(link)}" style="background:#2f5fd0;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">${esc(copy.button)}</a></p>
<p style="font-size:12px;color:#52607a;margin:0 0 4px">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>`;
  const html = `<div style="background:#eef2f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2a44">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe3f1">
<div style="background:#0f1d3a;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700">Amuwa Corporation <span style="font-weight:400;opacity:.8">· ${esc(brand.replace('Amuwa ', ''))}</span></div>
<div style="padding:24px">
<h1 style="font-size:20px;margin:0 0 12px;color:#0f1d3a">${esc(copy.heading)}</h1>
<p>Hello ${esc(name)},</p>
<p>${esc(copy.intro)}</p>
${action}
<p style="color:#52607a;font-size:13px">${esc(copy.outro)}</p>
<p style="margin-bottom:0;color:#52607a;font-size:13px">Amuwa Corporation</p>
</div></div></div>`;
  const text = [
    `Hello ${name},`,
    '',
    copy.intro,
    '',
    copy.code ? `Your code: ${payload.email_data.token}` : `${copy.button}: ${link}`,
    '',
    copy.outro,
    '',
    'Amuwa Corporation'
  ].join('\n');
  return { subject: copy.subject, html, text, brand };
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------
export interface HookDeps {
  settings: () => AutomationSettings;
  send: typeof sendEmail;
  supabaseUrl: () => string;
  secret: () => string | undefined;
  now: () => number;
  /**
   * true while this recipient (and the site as a whole) may get another auth e-mail: however a reset or sign-up was triggered (the portal,
   * the CRM, or Supabase's API called directly), nobody can flood an inbox with links or spend the mail account's reputation.
   */
  allow: (email: string) => Promise<boolean>;
}

async function allowAuthMail(email: string): Promise<boolean> {
  try {
    await enforce(
      [
        { key: `authmail:rcpt:${email.trim().toLowerCase()}`, limit: limitOf('AUTH_MAIL_PER_RECIPIENT_HOUR'), window: 3600 },
        { key: 'authmail:site', limit: limitOf('AUTH_MAIL_SITE_HOUR'), window: 3600 }
      ],
      'shared'
    );
    return true;
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_LIMITED') return false;
    return true; // the limiter itself failing must not stop sign-in e-mails
  }
}

const defaults: HookDeps = {
  // sign-up / reset / invite / magic-link e-mails: EMAIL_FROM_AUTH when set
  settings: () => senderSettings('auth', automationSettings()),
  send: sendEmail,
  supabaseUrl: () => getEnv().supabaseUrl,
  secret: () => process.env.SUPABASE_AUTH_HOOK_SECRET,
  now: Date.now,
  allow: allowAuthMail
};

/**
 * Handles one hook request. Never throws: the answer is what Supabase is told. Nothing secret or personal is logged
 * (no link, no code, no address).
 */
export async function handleAuthEmailHook(
  req: { body: string; id?: string; timestamp?: string; signature?: string },
  deps: Partial<HookDeps> = {}
): Promise<HookReply> {
  const d = { ...defaults, ...deps };
  const key = hookKey(d.secret());
  if (!key) return fail(503, 'The sign-up e-mail hook is not configured on the server.');
  if (Buffer.byteLength(req.body) > HOOK_MAX_BODY_BYTES) return fail(413, 'The request is too large.');
  if (!verifyHookSignature(key, req, req.body, d.now())) return fail(401, 'The request signature is not valid.');

  let payload: AuthHookPayload;
  try {
    payload = hookSchema.parse(JSON.parse(req.body));
  } catch {
    return fail(400, 'The request is not a valid auth e-mail hook payload.');
  }

  let rendered: ReturnType<typeof renderAuthEmail>;
  try {
    rendered = renderAuthEmail(payload, d.supabaseUrl());
  } catch {
    return fail(503, 'The server is not configured to build sign-in links.');
  }
  if (!rendered) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'auth e-mail hook: unsupported e-mail type', type: payload.email_data.email_action_type }));
    return fail(422, `This e-mail type (${payload.email_data.email_action_type}) is not supported yet.`);
  }

  if (!(await d.allow(payload.user.email))) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'auth e-mail hook: rate limited', type: payload.email_data.email_action_type }));
    return fail(429, 'Too many e-mails were requested for this address. Please wait an hour and try again.');
  }

  // Auth e-mails carry one-time links: never copy them to the CRM's CC / BCC lists, and sign them with the right product name.
  const base = d.settings();
  const settings: AutomationSettings = { ...base, email: { ...base.email, fromName: rendered.brand === 'Amuwa Careers' ? 'Amuwa Careers' : base.email.fromName, cc: [], bcc: [] } };
  let result: SendResult;
  try {
    // AUTH: never copied (enforced again in providers.ts and the database), CRITICAL (never waits behind other mail). The webhook id makes a
    // Supabase retry of the same request answer "already sent" instead of e-mailing a second link.
    result = await d.send(settings, { email: payload.user.email, name: displayName(payload.user) }, rendered, undefined, {
      category: 'AUTH', priority: 'CRITICAL', sensitive: true, application: audienceOf(payload.user) === 'CANDIDATE' ? 'CANDIDATE_PORTAL' : 'CRM',
      template: `auth-${payload.email_data.email_action_type}`, ...(req.id && /^[A-Za-z0-9_.:-]{8,120}$/.test(req.id) ? { idempotencyKey: `auth-hook:${req.id}` } : {})
    });
  } catch {
    result = { ok: false, retry: true, code: null, ref: null, detail: 'The mail provider call failed.' };
  }
  if (!result.ok) {
    console.error(JSON.stringify({ level: 'error', msg: 'auth e-mail hook: send failed', type: payload.email_data.email_action_type, detail: result.detail }));
    return fail(result.retry ? 503 : 502, 'The e-mail could not be sent right now. Please try again in a few minutes.');
  }
  return { status: 200, body: {} };
}
