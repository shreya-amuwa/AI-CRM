import { staffForgotPasswordSchema } from '../../shared/validation.js';
import { automationSettings, DEFAULT_APP_URL, liveChannels, senderSettings } from '../automations/config.js';
import { sendEmail } from '../automations/providers.js';
import type { RenderedEmail } from '../automations/templates.js';
import { hasServiceClient } from '../db/supabase.js';
import { requestInfo } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import { recordSecurityEvent } from '../security/events.js';

/**
 * "Forgot password?" on the staff sign-in page (no login). Always answers the same way, so nobody can find out which addresses belong to
 * an employee. Only an ACTIVE employee gets the one-time link; it opens the CRM's own /set-password page (the same page as the welcome
 * e-mail), where the employee chooses a new password. Nothing is verified until they press Save, so an e-mail scanner that opens the link
 * cannot use it up. The link and the address are never logged.
 */
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderStaffResetEmail(p: { name: string; link: string }): RenderedEmail {
  const name = (p.name || '').trim().slice(0, 80) || 'there';
  const subject = 'Reset your password – Amuwa CRM';
  const html = `<div style="background:#eef2f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2a44">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe3f1">
<div style="background:#0f1d3a;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700">Amuwa Corporation <span style="font-weight:400;opacity:.8">· CRM</span></div>
<div style="padding:24px">
<h1 style="font-size:20px;margin:0 0 12px;color:#0f1d3a">Reset your password</h1>
<p>Hello ${esc(name)},</p>
<p>We received a request to reset the password of your Amuwa CRM account. Use the button below to choose a new one. The link works once and for a limited time.</p>
<p style="margin:18px 0"><a href="${esc(p.link)}" style="background:#2f5fd0;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">Choose a new password</a></p>
<p style="font-size:12px;color:#52607a;margin:0 0 4px">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(p.link)}</span></p>
<p style="color:#52607a;font-size:13px">If you did not ask for this, ignore this email: your password stays as it is. Nobody from Amuwa will ever ask you for your password.</p>
<p style="margin-bottom:0;color:#52607a;font-size:13px">Amuwa Corporation</p>
</div></div></div>`;
  const text = [
    `Hello ${name},`, '',
    'We received a request to reset the password of your Amuwa CRM account. Open this link to choose a new one (it works once and for a limited time):',
    p.link, '',
    'If you did not ask for this, ignore this email: your password stays as it is.', '',
    'Amuwa Corporation'
  ].join('\n');
  return { subject, html, text };
}

export interface StaffResetDeps {
  lookup: (email: string) => Promise<{ id: string; email: string; name: string } | null>;
  link: (email: string, redirectTo: string) => Promise<string>;
}

export async function staffForgotPassword(body: unknown, deps?: StaffResetDeps): Promise<{ ok: true }> {
  const { email } = parse(staffForgotPasswordSchema, body);
  if (!deps && !hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE');
  const authAdmin = deps ? null : new AuthAdminRepository();
  const d: StaffResetDeps = deps ?? { lookup: e => authAdmin!.staffLoginForReset(e), link: (e, r) => authAdmin!.passwordLink(e, r) };
  const s = senderSettings('auth', automationSettings());
  const login = await d.lookup(email);
  // The answer never tells the caller whether the address has an account; the log does (without the address).
  const info = requestInfo.getStore();
  await recordSecurityEvent({
    action: 'STAFF_PASSWORD_RESET_REQUESTED', entityType: 'auth', actorId: null, outcome: 'SUCCESS', requestId: info?.requestId, ip: info?.ip,
    dedupeKey: `staff-reset:${info?.ip ?? 'unknown'}:${Math.floor(Date.now() / 300_000)}:${login ? 'match' : 'none'}`, metadata: { matched: !!login }
  });
  if (!login) return { ok: true };
  if (s.mode !== 'live' || !liveChannels(s).includes('EMAIL')) {
    console.warn('[api] staff reset e-mail not sent: e-mail sending is not live on the server');
    return { ok: true };
  }
  if (s.testRecipients && !s.testRecipients.emails.has(login.email.toLowerCase())) return { ok: true };
  try {
    // always the CRM's own address (APP_URL), never the caller's Origin
    const link = await d.link(login.email, `${s.appUrl ?? DEFAULT_APP_URL}/set-password?purpose=reset`);
    // a one-time link: never copied to the CRM's CC / BCC lists
    const r = await sendEmail({ ...s, email: { ...s.email, cc: [], bcc: [] } }, { email: login.email, name: login.name }, renderStaffResetEmail({ name: login.name, link }));
    if (!r.ok) console.warn('[api] staff reset e-mail not sent', r.detail);
  } catch (e) {
    console.warn('[api] staff reset link failed', (e as Error)?.message);
  }
  return { ok: true };
}
