// Unit test of the e-mail router (server/automations/providers.ts + server/email/*): the provider order and the SES approval switch, the
// failure classification, failover only after a definite provider refusal (never after an invalid recipient or a timeout), the shared
// record (duplicates, suppression, CC / BCC from the rules, the category's sender, refused providers), the Resend Idempotency-Key and
// quota headers, no copies of authentication e-mail, and the Resend webhook signature. A local mock stands in for Resend and SES.
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { automationSettings, liveChannels } from '../../server/automations/config';
import { resetResendPause, sendEmail } from '../../server/automations/providers';
import { classifyResend, classifySes, classifySmtp, classifyThrown } from '../../server/email/classify';
import { parseOrder, providerRoute } from '../../server/email/routing';
import type { BeginAnswer, BeginRequest, FinishRequest, Ledger } from '../../server/email/ledger';
import { handleResendWebhook } from '../../server/email/resendWebhook';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };

// --- mock Resend + SES
type Call = { path: string; headers: http.IncomingHttpHeaders; body: any };
const calls: Call[] = [];
const plan: Record<string, { status: number; body: unknown; headers?: Record<string, string> }[]> = { resend: [], ses: [] };
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const path = (req.url || '').split('?')[0];
    calls.push({ path, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const which = path.startsWith('/v2/') ? 'ses' : 'resend';
    const next = plan[which].shift() ?? { status: 200, body: which === 'ses' ? { MessageId: 'ses-1' } : { id: 're-1' } };
    res.writeHead(next.status, { 'content-type': 'application/json', ...(next.headers ?? {}) });
    res.end(JSON.stringify(next.body));
  });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

const ENV_KEYS = ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_FALLBACK', 'EMAIL_PROVIDER_ORDER', 'EMAIL_SES_PRODUCTION_ENABLED', 'SES_REGION', 'SES_ACCESS_KEY_ID',
  'SES_SECRET_ACCESS_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_API_BASE_URL', 'EMAIL_CC', 'EMAIL_BCC', 'EMAIL_FROM', 'RESEND_MAX_PER_SECOND', 'SES_MAX_PER_SECOND'];
const setEnv = (e: Record<string, string>) => {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { EMAIL_API_BASE_URL: base, RESEND_MAX_PER_SECOND: '100', SES_MAX_PER_SECOND: '200', EMAIL_FROM: 'Amuwa Corporation <no-reply@amuwa.com>' }, e);
  resetResendPause();
};
const RESEND = { EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_test_key' };
const SES = { SES_REGION: 'ap-southeast-2', SES_ACCESS_KEY_ID: 'AKIAEXAMPLE', SES_SECRET_ACCESS_KEY: 'secretsecretsecret' };
const SMTP = { SMTP_HOST: '127.0.0.1', SMTP_USER: 'meta@amuwa.com', SMTP_PASS: 'x' };

// --- 1. the route
setEnv({ ...RESEND, ...SES, ...SMTP });
let route = providerRoute(automationSettings());
check(route.order.join() === 'resend,smtp' && route.excluded.some(x => x.provider === 'ses' && x.reason === 'SES_NOT_APPROVED'),
  'Phase A: Resend then SMTP; SES (sandbox) is never a fallback', route);
setEnv({ ...RESEND, ...SES, ...SMTP, EMAIL_SES_PRODUCTION_ENABLED: 'true' });
check(providerRoute(automationSettings()).order.join() === 'resend,ses,smtp', 'SES approved: Resend, SES, SMTP');
setEnv({ ...RESEND, ...SES, ...SMTP, EMAIL_PROVIDER_ORDER: 'ses,resend,smtp' });
check(providerRoute(automationSettings()).order.join() === 'resend,smtp', 'an order naming SES does nothing until SES is approved');
setEnv({ ...RESEND, ...SES, ...SMTP, EMAIL_PROVIDER_ORDER: 'ses,resend,smtp', EMAIL_SES_PRODUCTION_ENABLED: 'true' });
check(providerRoute(automationSettings()).order.join() === 'ses,resend,smtp', 'Phase B: SES first, without a code change');
setEnv({ EMAIL_PROVIDER: 'ses', ...SES, ...SMTP });
check(providerRoute(automationSettings()).order.join() === 'ses,smtp', 'an explicit EMAIL_PROVIDER=ses keeps working as before');
check(parseOrder('resend,gmail') === null && parseOrder('resend,resend') === null && parseOrder('') === null, 'a typo in the order is ignored (never routes elsewhere)');
setEnv({ ...RESEND, ...SMTP, EMAIL_FALLBACK: 'off' });
check(providerRoute(automationSettings()).order.join() === 'resend', 'EMAIL_FALLBACK=off: the primary only');
setEnv({ EMAIL_PROVIDER: 'resend', ...SMTP, EMAIL_FALLBACK: 'off' });
check(providerRoute(automationSettings()).order.length === 0 && !liveChannels(automationSettings()).includes('EMAIL'),
  'EMAIL_FALLBACK=off and no Resend key: nothing sends (the mailbox does not stand in)');
setEnv({ ...RESEND });
check(automationSettings().email.ses === null, 'no SES keys: SES is not configured');
setEnv({ ...SES, EMAIL_PROVIDER: 'ses', SES_REGION: '' });
check(automationSettings().email.ses?.region === 'ap-southeast-2', 'SES_REGION unset: Asia Pacific (Sydney), where Amuwa\'s identity is verified');

// --- 2. classification
check(classifyResend(429, 'daily_quota_exceeded', '').category === 'QUOTA_DAILY' && classifyResend(429, 'daily_quota_exceeded', '').failover, 'Resend daily quota: fail over');
check(classifyResend(429, 'monthly_quota_exceeded', '').category === 'QUOTA_MONTHLY', 'Resend monthly quota');
check(classifyResend(429, 'rate_limit_exceeded', '').category === 'RATE_LIMIT', 'Resend rate limit');
check(classifyResend(401, 'missing_api_key', '').category === 'AUTH_INVALID' && classifyResend(401, '', '').failover, 'invalid Resend key: fail over');
check(classifyResend(403, 'validation_error', 'The amuwa.com domain is not verified').category === 'DOMAIN_UNVERIFIED', 'unverified domain');
check(!classifyResend(422, 'validation_error', 'Invalid `to` field. The email address needs to follow the email@example.com format').failover
      && classifyResend(422, 'validation_error', 'Invalid `to` field.').category === 'INVALID_RECIPIENT', 'an invalid recipient is never retried through another provider');
check(classifyResend(413, '', '').category === 'ATTACHMENT_TOO_LARGE' && !classifyResend(413, '', '').failover, 'attachment too large: no failover');
check(classifyResend(503, '', '').category === 'TEMPORARY' && classifyResend(503, '', '').failover, 'Resend 5xx: temporary, fail over');
check(classifySes(400, 'MessageRejected', 'Email address is not verified. The following identities failed the check in region AP-SOUTHEAST-2: x@y.com (recipient)').category === 'SES_SANDBOX',
  'SES sandbox (recipient not verified)');
check(classifySes(400, 'MessageRejected', 'Email address is not verified. The following identities failed the check: no-reply@amuwa.com').category === 'DOMAIN_UNVERIFIED',
  'sender not verified in this region (a region mismatch)');
check(classifySes(403, 'InvalidClientTokenId', 'The security token included in the request is invalid.').category === 'AUTH_INVALID', 'invalid SES keys');
check(classifySes(429, 'TooManyRequestsException', 'Daily message quota exceeded.').category === 'QUOTA_DAILY', 'SES daily quota');
check(classifySes(429, 'TooManyRequestsException', 'Maximum sending rate exceeded.').category === 'RATE_LIMIT', 'SES throttling');
check(classifySes(400, 'AccountSuspendedException', '').category === 'ACCOUNT_SUSPENDED', 'SES account suspended');
check(classifySmtp(535).category === 'AUTH_INVALID' && classifySmtp(550).category === 'INVALID_RECIPIENT' && classifySmtp(421).category === 'TEMPORARY', 'SMTP codes');
const timeout = classifyThrown(Object.assign(new Error('x'), { name: 'TimeoutError' }));
check(timeout.outcome === 'UNKNOWN_ACCEPTANCE' && !timeout.failover, 'a timeout is UNKNOWN_ACCEPTANCE: never sent again through another provider');
check(classifyThrown(new TypeError('fetch failed')).failover, 'a refused connection never reached the provider: fail over');

// --- 3. sending, with a fake shared record
class FakeLedger implements Ledger {
  begun: BeginRequest[] = [];
  finished: FinishRequest[] = [];
  answer: Partial<BeginAnswer> = {};
  async begin(r: BeginRequest): Promise<BeginAnswer> {
    this.begun.push(r);
    return { logId: '00000000-0000-4000-8000-000000000001', duplicate: null, cc: r.cc, bcc: r.bcc, suppressed: [], sender: null, providers: null, ...this.answer };
  }
  async finish(r: FinishRequest) { this.finished.push(r); }
}
const to = { email: 'client@example.org', name: 'Client' };
const mail = { subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' };
const resendCalls = () => calls.filter(c => c.path === '/emails');
const sesCalls = () => calls.filter(c => c.path.startsWith('/v2/'));

setEnv({ ...RESEND, ...SES, EMAIL_SES_PRODUCTION_ENABLED: 'true', EMAIL_CC: 'ops@amuwa.com' });
let L = new FakeLedger();
calls.length = 0;
plan.resend.push({ status: 200, body: { id: 're-42' }, headers: { 'x-resend-daily-quota': '12', 'x-resend-monthly-quota': '340' } });
let r = await sendEmail(automationSettings(), to, mail, undefined, { category: 'INVOICE', idempotencyKey: 'invoice-send:abc12345', ledger: L, context: { customerId: '00000000-0000-4000-8000-0000000000aa' } });
check(r.ok && r.provider === 'resend' && r.ref === 're-42', 'Resend accepts: sent by Resend');
check(resendCalls()[0]?.headers['idempotency-key'] === 'invoice-send:abc12345', 'the business event key is sent to Resend as Idempotency-Key');
check(JSON.stringify(resendCalls()[0]?.body.cc) === '["ops@amuwa.com"]', 'the deployment\'s EMAIL_CC still applies to ordinary e-mail');
check(L.begun[0].category === 'INVOICE' && L.begun[0].context.customerId === '00000000-0000-4000-8000-0000000000aa' && L.begun[0].providers.join() === 'resend,ses',
  'the shared record gets the category, the record and the route');
check(L.finished[0].status === 'ACCEPTED' && L.finished[0].usage?.daily === '12' && L.finished[0].usage?.monthly === '340', 'Resend\'s reported quota use is kept (as reported)');

// failover after a definite quota refusal; SES approved
L = new FakeLedger(); calls.length = 0;
plan.resend.push({ status: 429, body: { name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.' } });
r = await sendEmail(automationSettings(), to, mail, undefined, { ledger: L });
check(r.ok && r.provider === 'ses' && /Sent through Amazon SES \(fallback\)/.test(r.detail) && sesCalls().length === 1, 'Resend quota reached: sent through approved SES', r);
check(L.finished[0].fallbackUsed && L.finished[0].attempts.map(a => `${a.provider}:${a.outcome}:${a.category ?? ''}`).join() === 'resend:RETRYABLE:QUOTA_DAILY,ses:ACCEPTED:',
  'both attempts are recorded, with the reason', L.finished[0].attempts);
calls.length = 0;
r = await sendEmail(automationSettings(), to, mail, undefined, { ledger: new FakeLedger() });
check(r.ok && r.provider === 'ses' && resendCalls().length === 0, 'after a quota answer Resend is skipped for a while');

// SES not approved: never used for real recipients
setEnv({ ...RESEND, ...SES });
L = new FakeLedger(); calls.length = 0;
plan.resend.push({ status: 429, body: { name: 'daily_quota_exceeded', message: 'quota' } });
r = await sendEmail(automationSettings(), to, mail, undefined, { ledger: L });
check(!r.ok && r.retry && sesCalls().length === 0, 'SES still in the sandbox: not used as a fallback; the e-mail waits for a retry', r);

// an invalid recipient is not retried elsewhere
setEnv({ ...RESEND, ...SES, EMAIL_SES_PRODUCTION_ENABLED: 'true' });
calls.length = 0;
plan.resend.push({ status: 422, body: { name: 'validation_error', message: 'Invalid `to` field.' } });
r = await sendEmail(automationSettings(), to, mail, undefined, { ledger: new FakeLedger() });
check(!r.ok && !r.retry && sesCalls().length === 0 && r.errorCategory === 'INVALID_RECIPIENT', 'an invalid recipient: refused, not sent through SES');

// both failing
calls.length = 0;
plan.resend.push({ status: 500, body: { message: 'internal' } });
plan.ses.push({ status: 500, body: { message: 'internal' } });
L = new FakeLedger();
r = await sendEmail(automationSettings(), to, mail, undefined, { ledger: L });
check(!r.ok && r.retry && /Resend HTTP 500.*SES fallback: HTTP 500/.test(r.detail) && L.finished[0].status === 'RETRY_PENDING', 'both providers failing: kept for a retry, with both reasons, never reported as sent', r);

// the shared record decides
calls.length = 0;
L = new FakeLedger(); L.answer = { duplicate: 'ACCEPTED', duplicateProvider: 'resend', duplicateRef: 're-old' };
r = await sendEmail(automationSettings(), to, mail, undefined, { idempotencyKey: 'decision-email:1234abcd', ledger: L });
check(r.ok && r.ref === 're-old' && calls.length === 0, 'the same business event again: answered from the record, nothing is sent (no duplicate)');
L = new FakeLedger(); L.answer = { duplicate: 'IN_PROGRESS' };
r = await sendEmail(automationSettings(), to, mail, undefined, { idempotencyKey: 'decision-email:1234abcd', ledger: L });
check(!r.ok && r.retry && calls.length === 0, 'being sent by another Worker: not sent twice');
L = new FakeLedger(); L.answer = { duplicate: 'UNKNOWN_ACCEPTANCE', duplicateProvider: 'ses' };
r = await sendEmail(automationSettings(), to, mail, undefined, { idempotencyKey: 'decision-email:1234abcd', ledger: L });
check(!r.ok && !r.retry && r.unknownAcceptance && calls.length === 0, 'after an unknown outcome at SES: not resent anywhere automatically');
L = new FakeLedger(); L.answer = { duplicate: 'UNKNOWN_ACCEPTANCE', duplicateProvider: 'resend' };
r = await sendEmail(automationSettings(), to, mail, undefined, { idempotencyKey: 'decision-email:1234abcd', ledger: L });
check(r.ok && resendCalls().length === 1 && resendCalls()[0].headers['idempotency-key'] === 'decision-email:1234abcd' && sesCalls().length === 0,
  'after an unknown outcome at Resend: asked again only at Resend, with the same Idempotency-Key (Resend never sends it twice)');
calls.length = 0;
L = new FakeLedger(); L.answer = { suppressed: ['client@example.org'] };
r = await sendEmail(automationSettings(), to, mail, undefined, { ledger: L });
check(!r.ok && !r.retry && calls.length === 0 && L.finished[0].status === 'SUPPRESSED', 'a suppressed address: not sent by any provider');
L = new FakeLedger(); L.answer = { cc: ['verifier@amuwa.com'], bcc: ['cto@amuwa.com'], sender: { email: 'tech@amuwa.com', name: 'Amuwa Technical', replyTo: 'support@amuwa.com' } };
r = await sendEmail(automationSettings(), to, mail, undefined, { category: 'TECHNICAL', ledger: L });
const sent = resendCalls().at(-1)!.body;
check(JSON.stringify(sent.cc) === '["verifier@amuwa.com"]' && JSON.stringify(sent.bcc) === '["cto@amuwa.com"]', 'the rules\' CC / BCC are used');
check(sent.from === 'Amuwa Technical <tech@amuwa.com>' && sent.reply_to === 'support@amuwa.com', 'the category\'s sender and reply-to are used');
calls.length = 0;
L = new FakeLedger(); L.answer = { providers: [{ provider: 'resend', allowed: false, reason: 'CRITICAL_RESERVE' }, { provider: 'ses', allowed: true, reason: null }] };
r = await sendEmail(automationSettings(), to, mail, undefined, { ledger: L });
check(r.ok && r.provider === 'ses' && resendCalls().length === 0, 'Resend\'s last e-mails kept for sign-in codes: a normal e-mail goes through SES');
calls.length = 0;
L = new FakeLedger(); L.answer = { providers: [{ provider: 'resend', allowed: false, reason: 'QUOTA_DAILY' }, { provider: 'ses', allowed: false, reason: 'QUOTA_DAILY' }] };
r = await sendEmail(automationSettings(), to, mail, undefined, { ledger: L });
check(!r.ok && r.retry && calls.length === 0 && L.finished[0].status === 'RETRY_PENDING', 'every provider out of quota: queued for later, nothing sent, not reported as sent');

// --- 4. authentication e-mail: never a copy
setEnv({ ...RESEND, EMAIL_CC: 'ops@amuwa.com', EMAIL_BCC: 'audit@amuwa.com' });
calls.length = 0;
L = new FakeLedger();
r = await sendEmail(automationSettings(), to, mail, undefined, { category: 'AUTH', ledger: L });
check(r.ok && resendCalls()[0].body.cc === undefined && resendCalls()[0].body.bcc === undefined, 'an OTP / reset e-mail ignores the global EMAIL_CC / EMAIL_BCC');
check(L.begun[0].sensitive && L.begun[0].cc.length === 0 && L.begun[0].bcc.length === 0 && L.begun[0].priority === 'CRITICAL', 'it is sent as sensitive and CRITICAL');
calls.length = 0;
r = await sendEmail(automationSettings(), to, mail, undefined, { category: 'AUTH', cc: ['hr@amuwa.com'], ledger: new FakeLedger() });
check(!r.ok && !r.retry && calls.length === 0, 'an explicit CC on an authentication e-mail is refused, nothing is sent');
r = await sendEmail(automationSettings(), to, mail, undefined, { category: 'GENERAL', sensitive: true, bcc: ['cto@amuwa.com'], ledger: new FakeLedger() });
check(!r.ok && calls.length === 0, 'any e-mail marked sensitive refuses a BCC');
r = await sendEmail(automationSettings(), to, mail, undefined, { category: 'CREDENTIALS', ledger: null });
check(r.ok && resendCalls()[0].body.cc === undefined, 'credentials (temporary password) get no copy even without the database');

// --- 5. the Resend webhook signature (Svix / Standard Webhooks)
const secret = 'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const body = JSON.stringify({ type: 'email.delivered', created_at: '2027-01-11T05:00:00.000Z', data: { email_id: 're-42', to: ['client@example.org'] } });
const ts = String(Math.floor(Date.now() / 1000));
const sig = `v1,${createHmac('sha256', Buffer.from('0123456789abcdef0123456789abcdef')).update(`msg_1.${ts}.${body}`).digest('base64')}`;
const recorded: any[] = [];
const record = async (e: any) => { recorded.push(e); return { duplicate: false, matched: true }; };
let w = await handleResendWebhook({ body, id: 'msg_1', timestamp: ts, signature: sig }, { secret: () => secret, record });
check(w.status === 200 && recorded[0]?.type === 'email.delivered' && recorded[0]?.providerMessageId === 're-42' && recorded[0]?.eventId === 'msg_1', 'a signed delivered event is recorded by its svix-id');
w = await handleResendWebhook({ body: body.replace('delivered', 'bounced'), id: 'msg_1', timestamp: ts, signature: sig }, { secret: () => secret, record });
check(w.status === 401 && recorded.length === 1, 'a changed body (or a forged signature) is refused');
w = await handleResendWebhook({ body, id: 'msg_1', timestamp: String(Number(ts) - 3600), signature: sig }, { secret: () => secret, record });
check(w.status === 401, 'an old replayed request is refused');
w = await handleResendWebhook({ body, id: 'msg_1', timestamp: ts }, { secret: () => secret, record });
check(w.status === 400, 'a request without the signature headers is refused');
w = await handleResendWebhook({ body, id: 'msg_1', timestamp: ts, signature: sig }, { secret: () => undefined, record });
check(w.status === 503, 'without RESEND_WEBHOOK_SECRET nothing is accepted');
const opened = JSON.stringify({ type: 'email.opened', data: { email_id: 're-42' } });
const sig2 = `v1,${createHmac('sha256', Buffer.from('0123456789abcdef0123456789abcdef')).update(`msg_2.${ts}.${opened}`).digest('base64')}`;
w = await handleResendWebhook({ body: opened, id: 'msg_2', timestamp: ts, signature: sig2 }, { secret: () => secret, record });
check(w.status === 200 && recorded.length === 1, 'opens and clicks are acknowledged but not tracked');
w = await handleResendWebhook({ body, id: 'msg_1', timestamp: ts, signature: sig }, { secret: () => secret, record: async () => { throw new Error('db down'); } });
check(w.status === 503, 'when the event cannot be recorded Resend is told to retry (it is not lost)');

server.close();
console.log(`=== EMAIL ROUTING TESTS PASSED (${passed}) ===`);
