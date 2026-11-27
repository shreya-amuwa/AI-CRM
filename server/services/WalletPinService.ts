import { automationSettings, liveChannels, senderSettings } from '../automations/config.js';
import { sendEmail } from '../automations/providers.js';
import type { RenderedEmail } from '../automations/templates.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { requestInfo } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { unwrap } from '../repositories/base.js';
import { recordSecurityEvent } from '../security/events.js';

/**
 * "Forgot PIN" on the Wallet (migration 20270222000100). The database makes a one-time code for the signed-in employee (only the service role may ask,
 * so a browser can never get a code without the e-mail); this e-mails it. The code is never returned, logged or stored in clear. The person types it
 * in the Wallet with a new PIN (wallet_pin_reset_finish, which checks it belongs to them).
 */
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderWalletPinResetEmail(p: { name: string; code: string }): RenderedEmail {
  const name = (p.name || '').trim().slice(0, 80) || 'there';
  const subject = 'Your Wallet PIN reset code – Amuwa CRM';
  const html = `<div style="background:#eef2f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2a44">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe3f1">
<div style="background:#0f1d3a;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700">Amuwa Corporation <span style="font-weight:400;opacity:.8">· CRM</span></div>
<div style="padding:24px">
<h1 style="font-size:20px;margin:0 0 12px;color:#0f1d3a">Reset your Wallet PIN</h1>
<p>Hello ${esc(name)},</p>
<p>Use this code in your Wallet (Forgot PIN) to choose a new PIN. It works once, for 30 minutes.</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0;color:#0f1d3a">${esc(p.code)}</p>
<p style="color:#52607a;font-size:13px">If you did not ask for this, ignore this email: your PIN stays as it is. Nobody from Amuwa will ever ask you for this code or your PIN.</p>
<p style="margin-bottom:0;color:#52607a;font-size:13px">Amuwa Corporation</p>
</div></div></div>`;
  const text = [`Hello ${name},`, '', 'Use this code in your Wallet (Forgot PIN) to choose a new PIN. It works once, for 30 minutes.', '', p.code, '',
    'If you did not ask for this, ignore this email: your PIN stays as it is.', '', 'Amuwa Corporation'].join('\n');
  return { subject, html, text };
}

export async function walletPinForgot(actorId: string): Promise<{ sent: boolean; detail?: string }> {
  if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'Wallet PIN reset is not set up on the server.');
  const t = unwrap(await getServiceClient().rpc('wallet_pin_reset_begin', { p_profile: actorId })) as { code: string; email: string; name: string };
  const info = requestInfo.getStore();
  await recordSecurityEvent({
    action: 'WALLET_PIN_RESET_CODE_REQUESTED', entityType: 'profile', entityId: actorId, actorId, outcome: 'SUCCESS', requestId: info?.requestId, ip: info?.ip,
    dedupeKey: `wallet-pin-reset:${actorId}:${Math.floor(Date.now() / 60_000)}`, metadata: {}
  }).catch(() => undefined);
  const s = senderSettings('auth', automationSettings());
  if (s.mode !== 'live') return { sent: false, detail: 'E-mails are switched off on the server. Ask your administrator.' };
  if (!liveChannels(s).includes('EMAIL')) return { sent: false, detail: 'E-mail sending is not set up on the server. Ask your administrator.' };
  if (s.testRecipients && !s.testRecipients.emails.has(t.email.toLowerCase())) return { sent: false, detail: 'Test mode: only the test recipients get e-mails.' };
  // a one-time code: never copied to the CC / BCC lists
  const r = await sendEmail({ ...s, email: { ...s.email, cc: [], bcc: [] } }, { email: t.email, name: t.name }, renderWalletPinResetEmail({ name: t.name, code: t.code }), undefined,
    { category: 'AUTH', priority: 'CRITICAL', template: 'wallet-pin-reset' });
  return r.ok ? { sent: true } : { sent: false, detail: r.detail ?? 'The e-mail could not be sent. Try again in a minute.' };
}
