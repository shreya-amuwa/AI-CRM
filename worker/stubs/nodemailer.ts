/**
 * Stands in for nodemailer in the Cloudflare Worker (wrangler.jsonc "alias"): nodemailer needs Node's net / tls modules, which Workers do
 * not have. The Worker sends SMTP with its own client over Cloudflare's TCP sockets (server/automations/smtpSocket.ts, registered in
 * worker/entry.ts), so this is reached only if that registration is missing: the send then fails with a clear message and is retried.
 */
export const SMTP_UNAVAILABLE = 'SMTP is not available here: the Worker must start from worker/entry.ts (which enables SMTP over Cloudflare sockets), or use EMAIL_PROVIDER=resend.';

function createTransport(): never {
  throw Object.assign(new Error(SMTP_UNAVAILABLE), { code: 'ESMTPUNAVAILABLE' });
}

export default { createTransport };
