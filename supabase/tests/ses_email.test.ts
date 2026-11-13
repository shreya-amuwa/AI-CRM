/**
 * E-mail through AWS SES (no database): AWS request signing (checked against AWS's published example and an independent
 * implementation), the SendEmail request SES receives, what each SES answer leads to (sent / backup through the SMTP mailbox / kept for a
 * retry), the backup's sender rules, the per-kind senders (EMAIL_FROM_AUTH, ..._CAREERS, ..._CLIENT, ..._HR) and the pacing.
 * Run: npm run test:unit
 */
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { signRequest } from '../../server/storage/sigv4.js';
import { automationSettings, hrSenderName, liveChannels, senderSettings } from '../../server/automations/config.js';
import { resetResendPause, sendEmail } from '../../server/automations/providers.js';
import { startFakeSmtp } from './fake-smtp.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// ---- signing ---------------------------------------------------------------------------------------------------------------------
{
  const doc = signRequest({
    method: 'GET', url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08', service: 'iam', region: 'us-east-1',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, now: new Date('2015-08-30T12:36:00Z')
  });
  check(doc.authorization.endsWith('Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7'), "AWS's published Signature V4 example gives AWS's signature", doc.authorization);
  // the same request signed by aws4fetch (an independent, widely used implementation) gave this signature
  const body = JSON.stringify({ FromEmailAddress: 'Amuwa <auth@amuwa.com>', Content: { Simple: { Subject: { Data: 'Hi ₹' } } } });
  const ses = signRequest({
    method: 'POST', url: 'https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails?b=2&a=1%20x', service: 'ses', region: 'ap-south-1',
    accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret/EXAMPLE+key', body, now: new Date('2026-11-12T20:00:00Z')
  });
  check(ses.authorization === 'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20261112/ap-south-1/ses/aws4_request, SignedHeaders=host;x-amz-date, Signature=30bd1441fa6957fd81f02bd43873542566ea4bdf84f67cd9e8191dbcb7be1662',
    'an SES request (query string, UTF-8 body) is signed exactly as aws4fetch signs it', ses.authorization);
}

// ---- a fake SES that checks every request's signature the way AWS does --------------------------------------------------------------
const KEY = { id: 'AKIASESTEST', secret: 'ses/secret+KEY' };
type Reply = { status: number; type?: string; body: unknown; retryAfter?: string } | 'hang';
const replies: Reply[] = [];
const received: { body: any; signatureOk: boolean; at: number }[] = [];
function signatureOk(h: IncomingHttpHeaders, body: string, port: number): boolean {
  const auth = String(h.authorization || '');
  const date = String(h['x-amz-date'] || '');
  if (!/^\d{8}T\d{6}Z$/.test(date)) return false;
  const expect = signRequest({
    method: 'POST', url: `http://127.0.0.1:${port}/v2/email/outbound-emails`, service: 'ses', region: 'ap-south-1', accessKeyId: KEY.id, secretAccessKey: KEY.secret,
    headers: { 'content-type': String(h['content-type']) }, body,
    now: new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`)
  });
  return auth === expect.authorization;
}
const ses = createServer((req, res) => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => {
    const port = (ses.address() as { port: number }).port;
    received.push({ body: JSON.parse(b), signatureOk: req.method === 'POST' && req.url === '/v2/email/outbound-emails' && signatureOk(req.headers, b, port), at: Date.now() });
    const r = replies.shift() ?? { status: 200, body: { MessageId: `ses-${received.length}` } };
    if (r === 'hang') return; // no answer: a timeout
    res.writeHead(r.status, { 'content-type': 'application/json', ...(r.type ? { 'x-amzn-errortype': `${r.type}:http://internal.amazon.com/coral/com.amazonaws.sesv2/` } : {}), ...(r.retryAfter ? { 'retry-after': r.retryAfter } : {}) });
    res.end(JSON.stringify(r.body));
  });
});
await new Promise<void>(r => ses.listen(0, '127.0.0.1', r));
const sesUrl = `http://127.0.0.1:${(ses.address() as { port: number }).port}`;
const smtp = await startFakeSmtp({ mode: 'tls' });

const ENV_KEYS = ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_API_BASE_URL', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'EMAIL_FALLBACK', 'EMAIL_CC', 'EMAIL_BCC', 'SES_REGION', 'SES_ACCESS_KEY_ID',
  'SES_SECRET_ACCESS_KEY', 'SES_CONFIGURATION_SET', 'SES_MAX_PER_SECOND', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SEND_AS',
  'EMAIL_FROM_AUTH', 'EMAIL_REPLY_TO_AUTH', 'EMAIL_FROM_CAREERS', 'EMAIL_FROM_CLIENT', 'EMAIL_REPLY_TO_CLIENT', 'EMAIL_FROM_HR', 'HR_EMAIL_FROM_NAME'];
function settings(extra: Record<string, string> = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    EMAIL_PROVIDER: 'ses', SES_REGION: 'ap-south-1', SES_ACCESS_KEY_ID: KEY.id, SES_SECRET_ACCESS_KEY: KEY.secret, EMAIL_API_BASE_URL: sesUrl, SES_MAX_PER_SECOND: '200',
    EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>', EMAIL_REPLY_TO: 'meta@amuwa.com',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'true', SMTP_USER: 'meta@amuwa.com', SMTP_PASS: 'app-password',
    ...extra
  });
  return automationSettings();
}
const nodeTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the fake mailbox's certificate is self-signed
const mail = { subject: 'Your invoice — ₹1,180 paid', html: '<p>Hello</p>', text: 'Hello' };
const pdf = { filename: 'Invoice-AC-0007.pdf', content: new TextEncoder().encode('%PDF-1.7 fake'), contentType: 'application/pdf' };
const to = { email: 'client@example.com', name: 'Asha Pawar' };

// ---- a normal send --------------------------------------------------------------------------------------------------------------
{
  let s = settings({ SES_CONFIGURATION_SET: 'crm-default', EMAIL_CC: 'cc@amuwa.com', EMAIL_BCC: 'audit@amuwa.com' });
  check(s.email.provider === 'ses' && s.email.ses?.region === 'ap-south-1' && liveChannels(s).includes('EMAIL'), 'EMAIL_PROVIDER=ses with keys: e-mail is live');
  let r = await sendEmail(s, { ...to, display: true }, mail, [pdf]);
  const req = received.at(-1)!;
  check(r.ok && r.ref === `ses-${received.length}` && smtp.mails.length === 0, 'SES accepts: sent by SES, the mailbox is not used', r);
  check(req.signatureOk, 'the request is signed so that AWS can verify it (keys, date, body)');
  const b = req.body;
  check(b.FromEmailAddress === '"Amuwa Corporation" <meta@amuwa.com>' && b.Destination.ToAddresses[0] === '"Asha Pawar" <client@example.com>', 'sender and recipient with their names', b);
  check(JSON.stringify(b.Destination.CcAddresses) === '["cc@amuwa.com"]' && JSON.stringify(b.Destination.BccAddresses) === '["audit@amuwa.com"]' && JSON.stringify(b.ReplyToAddresses) === '["meta@amuwa.com"]', 'CC, BCC and reply-to');
  check(b.Content.Simple.Subject.Data === mail.subject && b.Content.Simple.Subject.Charset === 'UTF-8' && b.Content.Simple.Body.Html.Data === mail.html && b.Content.Simple.Body.Text.Data === mail.text, 'subject (₹ and — intact), HTML and text');
  const att = b.Content.Simple.Attachments?.[0];
  check(att && att.FileName === 'Invoice-AC-0007.pdf' && att.ContentType === 'application/pdf' && att.ContentDisposition === 'ATTACHMENT' && Buffer.from(att.RawContent, 'base64').toString() === '%PDF-1.7 fake', 'the invoice PDF is attached intact', att);
  check(b.ConfigurationSetName === 'crm-default', 'the configuration set is used when set');

  r = await sendEmail(settings(), { email: 'plain@example.com', name: 'P' }, mail);
  check(r.ok && received.at(-1)!.body.Destination.ToAddresses[0] === 'plain@example.com' && !received.at(-1)!.body.ConfigurationSetName, 'without display the recipient is the bare address');
  r = await sendEmail(settings({ EMAIL_FROM: 'आशा <meta@amuwa.com>' }), to, mail);
  check(r.ok && /^=\?UTF-8\?B\?.+\?= <meta@amuwa\.com>$/.test(received.at(-1)!.body.FromEmailAddress), 'a non-English sender name is encoded as SES requires', received.at(-1)!.body.FromEmailAddress);
  const before = received.length;
  r = await sendEmail(settings(), { email: 'bad@@example.com', name: 'X' }, mail);
  check(!r.ok && !r.retry && received.length === before && smtp.mails.length === 0, 'an invalid address is refused before calling SES (and not sent by the mailbox)', r);
}

// ---- what each SES answer leads to ------------------------------------------------------------------------------------------------
async function answer(reply: Reply | Reply[], extra: Record<string, string> = {}) {
  resetResendPause();
  replies.length = 0;
  replies.push(...(Array.isArray(reply) ? reply : [reply]));
  const mailsBefore = smtp.mails.length;
  const calls = received.length;
  const r = await sendEmail(settings(extra), to, mail);
  return { r, smtp: smtp.mails.length - mailsBefore, calls: received.length - calls };
}
{
  let x = await answer([{ status: 429, type: 'TooManyRequestsException', body: { message: 'Maximum sending rate exceeded.' }, retryAfter: '1' }, { status: 200, body: { MessageId: 'later' } }]);
  check(x.r.ok && x.r.ref === 'later' && x.calls === 2 && x.smtp === 0, 'throttled: waited and retried once, sent by SES', x);
  x = await answer([{ status: 429, type: 'TooManyRequestsException', body: { message: 'Maximum sending rate exceeded.' } }, { status: 429, type: 'TooManyRequestsException', body: { message: 'Maximum sending rate exceeded.' } }]);
  check(x.r.ok && x.calls === 2 && x.smtp === 1 && /fallback/.test(x.r.detail), 'still throttled after the retry: sent through the mailbox', x);
  x = await answer({ status: 429, type: 'TooManyRequestsException', body: { message: 'Daily message quota exceeded.' } });
  check(x.r.ok && x.calls === 1 && x.smtp === 1 && /quota/i.test(x.r.detail), 'daily quota reached: no retry, sent through the mailbox', x);
  const callsNow = received.length;
  const again = await sendEmail(settings(), to, mail);
  check(again.ok && received.length === callsNow, 'after the quota answer, the next e-mails go straight to the mailbox for a while');
  for (const [type, status, msg, label] of [
    ['SendingPausedException', 400, 'Sending is paused for this account.', 'sending paused'],
    ['AccountSuspendedException', 400, 'Your account is suspended.', 'account suspended'],
    ['MailFromDomainNotVerifiedException', 400, 'The MAIL FROM domain is not verified.', 'domain not verified'],
    ['MessageRejected', 400, 'Email address is not verified. The following identities failed the check in region AP-SOUTH-1: client@example.com', 'sandbox: recipient not verified'],
    ['UnrecognizedClientException', 403, 'The security token included in the request is invalid.', 'wrong keys (403)'],
    ['NotFoundException', 404, 'Configuration set crm-default does not exist.', 'configuration set missing'],
    ['InternalFailure', 500, 'Internal error', 'SES failing (500)']
  ] as const) {
    x = await answer({ status, type, body: { message: msg } });
    check(x.r.ok && x.smtp === 1, `${label}: delivered through the mailbox`, x);
  }
  x = await answer({ status: 400, type: 'MessageRejected', body: { message: 'Email address is not verified. The following identities failed the check in region AP-SOUTH-1: client@example.com' } }, { EMAIL_FALLBACK: 'off' });
  check(!x.r.ok && x.r.retry && !/client@example\.com/.test(x.r.detail) && /\[address\]/.test(x.r.detail), 'addresses quoted by SES are removed from the stored detail; kept for a retry', x.r);
  x = await answer({ status: 400, type: 'MessageRejected', body: { message: 'Illegal header: Subject.' } });
  check(!x.r.ok && !x.r.retry && x.smtp === 0, 'content refused (MessageRejected): not sent again by the mailbox, not retried', x);
  x = await answer({ status: 400, type: 'BadRequestException', body: { message: 'Missing final @domain' } });
  check(!x.r.ok && x.smtp === 0, 'invalid request (BadRequestException): not sent again by the mailbox', x);
  x = await answer('hang');
  check(!x.r.ok && x.r.retry && x.smtp === 0, 'no answer in time: not sent by the mailbox (SES may have sent it: no duplicate), kept for a retry', x);
  x = await answer({ status: 429, type: 'TooManyRequestsException', body: { message: 'Daily message quota exceeded.' } }, { EMAIL_FALLBACK: 'off' });
  check(!x.r.ok && x.r.retry && x.smtp === 0, 'EMAIL_FALLBACK=off: no mailbox copy, kept for a retry', x);
  resetResendPause();
  const s = settings({ SES_ACCESS_KEY_ID: '' });
  check(s.email.ses === null && liveChannels(s).includes('EMAIL'), 'SES keys not set yet but the mailbox is: e-mail stays live through the mailbox');
  const before2 = smtp.mails.length;
  const r = await sendEmail(s, to, mail);
  check(r.ok && smtp.mails.length === before2 + 1 && /SES is not set up/.test(r.detail), 'and is sent by the mailbox');
}

// ---- the backup's sender ---------------------------------------------------------------------------------------------------------
{
  const fromHeader = () => /^From: (.*)$/m.exec(smtp.mails.at(-1)!.data)?.[1] ?? '';
  const replyHeader = () => /^Reply-To: (.*)$/m.exec(smtp.mails.at(-1)!.data)?.[1] ?? '';
  resetResendPause();
  replies.length = 0;
  replies.push({ status: 400, type: 'SendingPausedException', body: { message: 'paused' } });
  let r = await sendEmail(senderSettings('auth', settings({ EMAIL_FROM_AUTH: 'Amuwa <auth@amuwa.com>', EMAIL_REPLY_TO_AUTH: 'support@amuwa.com' })), to, mail);
  check(r.ok && smtp.mails.at(-1)!.from === 'meta@amuwa.com' && /<meta@amuwa\.com>/.test(fromHeader()) && /support@amuwa\.com/.test(replyHeader()), 'auth@ is not a mailbox alias: the backup sends as meta@amuwa.com and keeps the reply-to', { from: fromHeader(), reply: replyHeader() });
  resetResendPause();
  replies.push({ status: 400, type: 'SendingPausedException', body: { message: 'paused' } });
  r = await sendEmail(senderSettings('auth', settings({ EMAIL_FROM_AUTH: 'Amuwa <auth@amuwa.com>', SMTP_SEND_AS: 'Auth@amuwa.com, sales@amuwa.com' })), to, mail);
  check(r.ok && /<auth@amuwa\.com>/.test(fromHeader()), 'auth@ listed in SMTP_SEND_AS (a Gmail alias): the backup keeps auth@ as the sender', fromHeader());
  resetResendPause();
  replies.push({ status: 400, type: 'SendingPausedException', body: { message: 'paused' } });
  r = await sendEmail(senderSettings('client', settings({ EMAIL_FROM_CLIENT: 'Amuwa <support@amuwa.com>', EMAIL_REPLY_TO_CLIENT: 'support@amuwa.com' })), to, mail);
  check(r.ok && /<meta@amuwa\.com>/.test(fromHeader()) && /support@amuwa\.com/.test(replyHeader()) && /^Amuwa/.test(fromHeader()), 'client e-mail in the backup: the mailbox sends it under the same name, replies still go to support@', { from: fromHeader(), reply: replyHeader() });
}

// ---- senders per kind of e-mail ------------------------------------------------------------------------------------------------
{
  const base = settings({
    EMAIL_FROM_AUTH: 'Amuwa <auth@amuwa.com>', EMAIL_REPLY_TO_AUTH: 'support@amuwa.com', EMAIL_FROM_CAREERS: 'Amuwa Careers <careers@amuwa.com>',
    EMAIL_FROM_CLIENT: 'Amuwa <support@amuwa.com>', EMAIL_REPLY_TO_CLIENT: 'support@amuwa.com', EMAIL_FROM_HR: 'Amuwa HR <hr@amuwa.com>'
  });
  const a = senderSettings('auth', base).email;
  const c = senderSettings('careers', base).email;
  const cl = senderSettings('client', base).email;
  const h = senderSettings('hr', base);
  check(a.fromEmail === 'auth@amuwa.com' && a.fromName === 'Amuwa' && a.replyTo === 'support@amuwa.com', 'auth e-mails: EMAIL_FROM_AUTH / EMAIL_REPLY_TO_AUTH');
  check(c.fromEmail === 'careers@amuwa.com' && c.fromName === 'Amuwa Careers' && c.replyTo === 'meta@amuwa.com', 'careers e-mails: EMAIL_FROM_CAREERS, default reply-to');
  check(cl.fromEmail === 'support@amuwa.com' && cl.replyTo === 'support@amuwa.com', 'client e-mails: EMAIL_FROM_CLIENT (unchanged behaviour)');
  check(h.email.fromEmail === 'hr@amuwa.com' && hrSenderName(h) === 'Amuwa HR', 'HR e-mails: EMAIL_FROM_HR and its name');
  process.env.HR_EMAIL_FROM_NAME = 'People Team';
  check(hrSenderName(h) === 'People Team', 'HR_EMAIL_FROM_NAME still wins, as before');
  const plain = settings();
  check(senderSettings('auth', plain) === plain && senderSettings('default', plain) === plain && hrSenderName(plain) === 'Amuwa Corporation HR', 'nothing set: every kind keeps EMAIL_FROM, HR keeps its old name');
}

// ---- pacing ----------------------------------------------------------------------------------------------------------------------
{
  resetResendPause(); // the backup checks above left SES paused (correctly): start fresh
  replies.length = 0;
  settings({ SES_MAX_PER_SECOND: '5' });
  const s = automationSettings();
  received.length = 0;
  for (let i = 0; i < 3; i++) await sendEmail(s, to, mail);
  check(received.length === 3 && received[2].at - received[0].at >= 360, 'calls are spaced to SES_MAX_PER_SECOND', received.map(r => r.at - received[0].at));
}

if (nodeTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
else process.env.NODE_TLS_REJECT_UNAUTHORIZED = nodeTls;
ses.close();
await smtp.close();
console.log(`\n${passed} AWS SES CHECKS PASSED`);
process.exit(0);
