/**
 * E-mail through the SMTP mailbox (meta@amuwa.com) and the Resend -> SMTP fallback, without a database:
 *  - the CRM's own SMTP client used on Cloudflare Workers (server/automations/smtpSocket.ts), here over a Node.js socket double with the
 *    same shape as Cloudflare's connect(): TLS from the start (465), STARTTLS (587), sign-in, recipients, attachments, header safety;
 *  - sendEmail(): when Resend refuses (limit reached, key refused, down) the same e-mail goes out through SMTP, but never after a timeout
 *    (Resend may have sent it) nor for an invalid request; after a quota answer Resend is skipped for a while; EMAIL_FALLBACK=off.
 * Run: npm run test:unit
 */
import { createServer } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { buildMime, smtpSendRaw, SmtpError, useSocketConnector, type SmtpSocket, type SocketConnector } from '../../server/automations/smtpSocket.js';
import { automationSettings, type AutomationSettings } from '../../server/automations/config.js';
import { resetResendPause, sendEmail } from '../../server/automations/providers.js';
import { mimePart, startFakeSmtp } from './fake-smtp.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

/** Node.js stand-in for cloudflare:sockets' connect() (the test certificate is self-signed, so it is not verified here). */
function wrap(sock: Socket): SmtpSocket {
  let onData: (d: Buffer) => void = () => undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      onData = d => c.enqueue(new Uint8Array(d));
      sock.on('data', onData);
      sock.on('end', () => { try { c.close(); } catch { /* closed */ } });
      sock.on('error', e => { try { c.error(e); } catch { /* closed */ } });
    }
  });
  const writable = new WritableStream<Uint8Array>({ write: chunk => new Promise<void>((res, rej) => sock.write(chunk, e => (e ? rej(e) : res()))) });
  return {
    readable,
    writable,
    startTls() {
      sock.off('data', onData);
      sock.removeAllListeners('end');
      return wrap(tlsConnect({ socket: sock, servername: 'localhost', rejectUnauthorized: false }));
    },
    close: async () => { sock.destroy(); }
  };
}
const nodeConnect: SocketConnector = ({ hostname, port }, { secureTransport }) =>
  wrap(secureTransport === 'on' ? tlsConnect({ host: hostname, port, rejectUnauthorized: false }) : netConnect({ host: hostname, port }));

const mail = { subject: 'Your invoice — ₹ 1,180 paid', html: '<p>Namaste <b>Asha</b>, your invoice is attached.</p>', text: 'Namaste Asha, your invoice is attached.' };
const pdf = { filename: 'Invoice-AC-0007.pdf', content: new TextEncoder().encode('%PDF-1.7 fake'), contentType: 'application/pdf' };

// ---- the message ---------------------------------------------------------------------------------------------------------------
{
  const raw = buildMime({
    from: { name: 'Amuwa Corporation', email: 'meta@amuwa.com' },
    to: { name: 'Asha Pawar', email: 'asha@example.com' },
    cc: ['cc@example.com'],
    replyTo: 'meta@amuwa.com',
    ...mail,
    subject: 'Line one\r\nBcc: attacker@example.com',
    attachments: [pdf]
  });
  const head = raw.split('\r\n\r\n')[0];
  check(!/^Bcc:/m.test(raw) && /^Subject: Line one Bcc: attacker@example.com$/m.test(head), 'a line break in the subject cannot add a header (no header injection)', head);
  check(/^From: "Amuwa Corporation" <meta@amuwa\.com>$/m.test(head) && /^To: "Asha Pawar" <asha@example\.com>$/m.test(head) && /^Cc: <cc@example\.com>$/m.test(head), 'From / To / Cc headers', head);
  check(mimePart(raw, 'text/html; charset=utf-8') === mail.html && mimePart(raw, 'text/plain; charset=utf-8') === mail.text, 'HTML and text bodies survive (base64, UTF-8)');
  check(/Content-Disposition: attachment; filename="Invoice-AC-0007.pdf"/.test(raw) && mimePart(raw, 'application/pdf; name="Invoice-AC-0007.pdf"') === '%PDF-1.7 fake', 'the PDF is attached intact');
  const utf = buildMime({ from: { name: 'Amuwa', email: 'meta@amuwa.com' }, to: { name: 'आशा', email: 'asha@example.com' }, cc: [], subject: mail.subject, html: 'h', text: 't' });
  const subj = /^Subject: (.+(?:\r\n .+)*)/m.exec(utf)![1];
  const decoded = subj.split(/\r\n /).map(w => Buffer.from(/=\?UTF-8\?B\?(.*)\?=/.exec(w)![1], 'base64').toString('utf8')).join('');
  check(decoded === mail.subject && /^To: =\?UTF-8\?B\?/m.test(utf), 'non-English subject and names are encoded (RFC 2047)', decoded);
  let bad = '';
  try { buildMime({ from: { name: 'A', email: 'meta@amuwa.com' }, to: { name: 'X', email: 'x@example.com>\r\nRCPT TO:<y@example.com' }, cc: [], subject: 's', html: 'h', text: 't' }); } catch (e) { bad = (e as Error).message; }
  check(/not valid/.test(bad), 'an address carrying SMTP commands is refused');
}

// ---- the SMTP conversation -----------------------------------------------------------------------------------------------------
const server = (port: number, secure: boolean, pass = 'app-password') => ({ host: '127.0.0.1', port, secure, user: 'meta@amuwa.com', pass });
{
  const tls = await startFakeSmtp({ mode: 'tls' });
  await smtpSendRaw(server(tls.port, true), { from: 'meta@amuwa.com', recipients: ['asha@example.com', 'bcc@example.com'] }, 'Subject: x\r\n\r\n.hidden line\r\nbody', { connect: nodeConnect });
  check(tls.mails.length === 1 && tls.mails[0].encrypted && JSON.stringify(tls.mails[0].rcpts) === '["asha@example.com","bcc@example.com"]', 'port 465 style: TLS from the start, every recipient (incl. BCC) in the envelope', tls.mails);
  check(tls.mails[0].data.includes('\r\n.hidden line\r\n'), 'a body line starting with "." is dot-stuffed and arrives unchanged');

  const st = await startFakeSmtp({ mode: 'starttls' });
  await smtpSendRaw(server(st.port, false), { from: 'meta@amuwa.com', recipients: ['asha@example.com'] }, 'Subject: y\r\n\r\nbody', { connect: nodeConnect });
  check(st.mails.length === 1 && st.mails[0].encrypted && st.plainLogins === 0, 'port 587 style: STARTTLS before the password is sent');

  const plain = await startFakeSmtp({ mode: 'plain' });
  let err: unknown = null;
  try {
    await smtpSendRaw({ ...server(plain.port, false), host: 'localhost' }, { from: 'meta@amuwa.com', recipients: ['a@example.com'] }, 'x', { connect: (a, o) => nodeConnect({ ...a, hostname: '127.0.0.1' }, o), allowPlaintext: false });
  } catch (e) { err = e; }
  check(err === null, 'a local test server may be plain');
  err = null;
  try {
    await smtpSendRaw({ ...server(plain.port, false), host: 'smtp.example.com' }, { from: 'meta@amuwa.com', recipients: ['a@example.com'] }, 'x', { connect: (a, o) => nodeConnect({ ...a, hostname: '127.0.0.1' }, o) });
  } catch (e) { err = e; }
  check(err instanceof SmtpError && /no encryption/.test(err.message) && plain.plainLogins === 1, 'a real server without encryption never gets the password', (err as Error)?.message);

  err = null;
  try { await smtpSendRaw(server(tls.port, true, 'wrong'), { from: 'meta@amuwa.com', recipients: ['a@example.com'] }, 'x', { connect: nodeConnect }); } catch (e) { err = e; }
  check(err instanceof SmtpError && err.code === 535, 'a wrong app password is SMTP 535', (err as Error)?.message);
  err = null;
  try { await smtpSendRaw(server(tls.port, true), { from: 'meta@amuwa.com', recipients: ['reject@example.com'] }, 'x', { connect: nodeConnect }); } catch (e) { err = e; }
  check(err instanceof SmtpError && err.code === 550, 'an unknown recipient is SMTP 550');
  err = null;
  try { await smtpSendRaw(server(1, true), { from: 'meta@amuwa.com', recipients: ['a@example.com'] }, 'x', { connect: nodeConnect, timeoutMs: 3000 }); } catch (e) { err = e; }
  check(err instanceof Error, 'an unreachable server fails instead of hanging');
  await Promise.all([tls.close(), st.close(), plain.close()]);
}

// ---- sendEmail: the SMTP provider and the Resend -> SMTP fallback ------------------------------------------------------------------
const smtp = await startFakeSmtp({ mode: 'tls' });
let resendStatus = 200;
let resendBody = '{"id":"re_1"}';
let resendCalls = 0;
let resendHang = false;
const resend = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    resendCalls++;
    if (resendHang) return; // never answers: a timeout
    res.writeHead(resendStatus, { 'content-type': 'application/json' });
    res.end(resendBody);
  });
});
await new Promise<void>(r => resend.listen(0, '127.0.0.1', r));
const resendUrl = `http://127.0.0.1:${(resend.address() as { port: number }).port}`;

const env = process.env;
function settings(extra: Record<string, string> = {}): AutomationSettings {
  for (const k of ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_API_BASE_URL', 'EMAIL_FROM', 'EMAIL_FALLBACK', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_CC', 'EMAIL_BCC']) delete env[k];
  Object.assign(env, {
    EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_key', EMAIL_API_BASE_URL: resendUrl, EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'true', SMTP_USER: 'meta@amuwa.com', SMTP_PASS: 'app-password',
    RESEND_MAX_PER_SECOND: '100', ...extra
  });
  return automationSettings();
}
const to = { email: 'client@example.com', name: 'Client' };
useSocketConnector(nodeConnect); // as on the Worker

{
  let s = settings();
  check(s.email.smtpFallback === true && s.email.smtp !== null, 'Resend + the SMTP mailbox set: the fallback is on');
  check(settings({ EMAIL_FALLBACK: 'off' }).email.smtpFallback === false, 'EMAIL_FALLBACK=off turns it off');

  // Resend works: SMTP is not touched
  s = settings();
  let r = await sendEmail(s, to, mail, [pdf]);
  check(r.ok && r.ref === 're_1' && smtp.mails.length === 0, 'Resend accepts: sent by Resend only', r);

  // daily limit reached
  resendStatus = 429; resendBody = '{"name":"daily_quota_exceeded","message":"You have reached your daily email sending quota."}';
  resendCalls = 0;
  r = await sendEmail(s, to, mail, [pdf]);
  check(r.ok && smtp.mails.length === 1 && /fallback/.test(r.detail) && /quota/.test(r.detail), 'Resend daily limit reached: the e-mail goes out through the SMTP mailbox', r);
  const sent = smtp.mails[0];
  check(sent.encrypted && sent.rcpts.includes('client@example.com') && /^From: "Amuwa Corporation" <meta@amuwa\.com>$/m.test(sent.data) && mimePart(sent.data, 'application/pdf; name="Invoice-AC-0007.pdf"') === '%PDF-1.7 fake', 'the fallback e-mail has the same sender, recipient and attachment', sent.data.slice(0, 400));
  const callsAfterQuota = resendCalls;
  r = await sendEmail(s, { email: 'next@example.com', name: 'N' }, mail);
  check(r.ok && resendCalls === callsAfterQuota && smtp.mails.length === 2, 'after a quota answer the next e-mails go straight to SMTP (Resend is not asked again for a while)');
  resetResendPause();

  for (const [status, body, label] of [[401, '{"name":"validation_error","message":"API key is invalid"}', 'Resend key refused (401)'], [403, '{"message":"The amuwa.com domain is not verified"}', 'domain not verified (403)'], [500, '{"message":"Internal server error"}', 'Resend is down (500)']] as const) {
    resendStatus = status; resendBody = body;
    const before = smtp.mails.length;
    r = await sendEmail(s, to, mail);
    check(r.ok && smtp.mails.length === before + 1, `${label}: delivered through SMTP`, r);
  }

  resendStatus = 422; resendBody = '{"name":"validation_error","message":"Invalid `to` field."}';
  let before = smtp.mails.length;
  r = await sendEmail(s, to, mail);
  check(!r.ok && smtp.mails.length === before && r.code === 422, 'an invalid request (422) is not sent again by SMTP', r);

  resendHang = true;
  before = smtp.mails.length;
  const started = Date.now();
  r = await sendEmail(s, to, mail);
  check(!r.ok && r.retry && smtp.mails.length === before, 'a Resend timeout is not sent again by SMTP (no duplicate e-mail); it stays queued for a retry', { r, ms: Date.now() - started });
  resendHang = false;

  resendStatus = 429; resendBody = '{"name":"daily_quota_exceeded","message":"quota"}';
  s = settings({ SMTP_PASS: 'wrong' });
  r = await sendEmail(s, to, mail);
  check(!r.ok && r.retry && /Resend HTTP 429/.test(r.detail) && /sign-in failed/.test(r.detail), 'both refused: kept for a retry, with both reasons', r);
  resetResendPause();

  s = settings({ EMAIL_FALLBACK: 'off' });
  before = smtp.mails.length;
  r = await sendEmail(s, to, mail);
  check(!r.ok && smtp.mails.length === before, 'EMAIL_FALLBACK=off: no SMTP copy');

  s = settings({ EMAIL_API_KEY: '' });
  r = await sendEmail(s, to, mail);
  check(r.ok && smtp.mails.length === before + 1, 'no Resend key yet but the mailbox is set: sent by SMTP');

  s = settings({ EMAIL_PROVIDER: 'smtp' });
  r = await sendEmail(s, to, mail, [pdf]);
  check(r.ok && r.code === 250 && smtp.mails.length === before + 2, 'EMAIL_PROVIDER=smtp works on the Worker path (sockets) too');

  // Node.js (Vercel, local): without a socket connector the fallback uses nodemailer
  useSocketConnector(null);
  resendStatus = 429; resendBody = '{"name":"monthly_quota_exceeded","message":"quota"}';
  s = settings({ SMTP_SECURE: 'true' });
  const n = smtp.mails.length;
  const nodeTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the test server's certificate is self-signed
  r = await sendEmail(s, to, mail);
  if (nodeTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = nodeTls;
  check(r.ok && smtp.mails.length === n + 1, 'on Node.js (Vercel / local) the fallback uses nodemailer', r);
  resetResendPause();
}

resend.close();
await smtp.close();
console.log(`\n${passed} SMTP / FALLBACK CHECKS PASSED`);
process.exit(0);
