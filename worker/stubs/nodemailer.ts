/**
 * Stands in for nodemailer in the Cloudflare Worker (wrangler.jsonc "alias"). SMTP needs raw TCP sockets that Workers do not give
 * nodemailer, so EMAIL_PROVIDER=smtp cannot send there: the send is refused with a clear message (and kept for a retry), and the
 * fix is EMAIL_PROVIDER=resend with EMAIL_API_KEY. Local development and the tests still use the real nodemailer.
 */
export const SMTP_UNAVAILABLE = 'SMTP is not available on Cloudflare Workers: set EMAIL_PROVIDER=resend and EMAIL_API_KEY.';

function createTransport(): never {
  throw Object.assign(new Error(SMTP_UNAVAILABLE), { code: 'ESMTPUNAVAILABLE' });
}

export default { createTransport };
