/**
 * Supabase "Send Email" auth hook (no database): the Standard Webhooks signature, every e-mail type, wording by audience, HTML escaping,
 * "no CC / BCC on one-time links", failures, and the real thing end to end: a signed HTTP request into the API, through the real nodemailer
 * SMTP path, into a tiny local mail server that records what it received.
 * Run: npm run test:unit
 */
import { createServer, type Server } from 'node:net';
import { createHmac } from 'node:crypto';
import {
  audienceOf, handleAuthEmailHook, hookKey, renderAuthEmail, signHook, verifyHookSignature, verifyUrl, type AuthHookPayload
} from '../../server/automations/authEmailHook.js';
import type { AutomationSettings } from '../../server/automations/config.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const SUPA = 'https://project.supabase.example';
const KEY_BYTES = Buffer.from('0123456789abcdef0123456789abcdef');
const SECRET = `v1,whsec_${KEY_BYTES.toString('base64')}`;
const key = hookKey(SECRET)!;

// ---- the secret and the signature ----------------------------------------------------------------------------------------------
check(hookKey(SECRET)?.equals(KEY_BYTES), 'the secret is read as Supabase shows it (v1,whsec_<base64>)');
check(hookKey(undefined) === null && hookKey('') === null && hookKey('v1,whsec_') === null && hookKey('v1,whsec_c2hvcnQ=') === null, 'a missing, empty or too short secret is refused');

const NOW = 1_800_000_000_000;
const ts = String(Math.floor(NOW / 1000));
const body = JSON.stringify({ hello: 'world' });
const sig = `v1,${signHook(key, 'msg_1', ts, body)}`;
check(verifyHookSignature(key, { id: 'msg_1', timestamp: ts, signature: sig }, body, NOW), 'a correctly signed request is accepted');
check(!verifyHookSignature(key, { id: 'msg_1', timestamp: ts, signature: sig }, body + ' ', NOW), 'a changed body is refused');
check(!verifyHookSignature(key, { id: 'msg_2', timestamp: ts, signature: sig }, body, NOW), 'a different message id is refused');
check(!verifyHookSignature(key, { id: 'msg_1', timestamp: String(Number(ts) - 301), signature: sig }, body, NOW), 'a request older than 5 minutes is refused (replay)');
check(!verifyHookSignature(key, { id: 'msg_1', timestamp: String(Number(ts) + 301), signature: sig }, body, NOW), 'a request from the future is refused');
check(!verifyHookSignature(key, { id: 'msg_1', timestamp: 'abc', signature: sig }, body, NOW), 'a non-numeric timestamp is refused');
check(!verifyHookSignature(key, { id: 'msg_1', timestamp: ts }, body, NOW) && !verifyHookSignature(key, { timestamp: ts, signature: sig }, body, NOW), 'missing headers are refused');
check(!verifyHookSignature(hookKey(`v1,whsec_${Buffer.from('another-secret-another-secret!!').toString('base64')}`)!, { id: 'msg_1', timestamp: ts, signature: sig }, body, NOW), 'a signature made with another secret is refused');
check(!verifyHookSignature(key, { id: 'msg_1', timestamp: ts, signature: 'v1,' + 'A'.repeat(sig.length - 3) }, body, NOW), 'a wrong signature of the right length is refused');
check(!verifyHookSignature(key, { id: 'msg_1', timestamp: ts, signature: sig.replace('v1,', 'v2,') }, body, NOW), 'an unknown signature version is refused');
check(verifyHookSignature(key, { id: 'msg_1', timestamp: ts, signature: `v1,AAAA ${sig}` }, body, NOW), 'several signatures in the header: any valid one is enough');

// ---- the e-mails -----------------------------------------------------------------------------------------------------------------
const mk = (type: string, meta: Record<string, unknown> | null = { candidate_portal: true, name: 'Asha Rao' }, extra: Partial<AuthHookPayload['email_data']> = {}): AuthHookPayload => ({
  user: { email: 'asha@example.com', user_metadata: meta },
  email_data: { token: '123456', token_hash: 'hash_abc', redirect_to: 'https://careers.example.com/auth/confirmed', email_action_type: type, ...extra }
});

check(audienceOf(mk('signup').user) === 'CANDIDATE' && audienceOf(mk('signup', {}).user) === 'STAFF' && audienceOf(mk('signup', null).user) === 'STAFF' && audienceOf(mk('signup', { candidate_portal: 'true' }).user) === 'STAFF', 'only candidate_portal === true is a candidate');

const link = verifyUrl(mk('signup').email_data, SUPA);
check(link === `${SUPA}/auth/v1/verify?token=hash_abc&type=signup&redirect_to=https%3A%2F%2Fcareers.example.com%2Fauth%2Fconfirmed`, 'the confirmation link is Supabase\'s verify endpoint with the token hash, type and redirect', link);
check(!verifyUrl(mk('signup', null, { redirect_to: 'javascript:alert(1)' }).email_data, SUPA).includes('redirect_to'), 'a redirect that is not http(s) is left out of the link');

const signup = renderAuthEmail(mk('signup'), SUPA)!;
check(signup.subject === 'Confirm your email – Amuwa Careers' && signup.html.includes('Hello Asha Rao,') && signup.html.includes(link.replace(/&/g, '&amp;')) && signup.html.includes('Confirm email address'), 'candidate sign-up: subject, greeting, button and link');
check(signup.text.includes(link) && signup.text.includes('Hello Asha Rao,'), 'the plain-text version carries the full link');
check(signup.html.includes('careers portal') && !signup.html.includes('CRM'), 'a candidate is told it is the careers portal, not the CRM');
const staffSignup = renderAuthEmail(mk('signup', {}), SUPA)!;
check(staffSignup.subject === 'Confirm your email – Amuwa CRM' && staffSignup.html.includes('Amuwa CRM') && staffSignup.html.includes('Hello asha,'), 'staff sign-up is worded for the CRM and greets by the e-mail name when there is no name');
check(renderAuthEmail(mk('recovery'), SUPA)!.subject === 'Reset your password – Amuwa Careers' && renderAuthEmail(mk('recovery', {}), SUPA)!.subject === 'Reset your password – Amuwa CRM', 'password reset subjects');
check(renderAuthEmail(mk('invite'), SUPA)!.html.includes('type=invite') && renderAuthEmail(mk('magiclink'), SUPA)!.html.includes('type=magiclink'), 'invite and magic-link e-mails use their own type in the link');
const otp = renderAuthEmail(mk('email'), SUPA)!;
check(otp.html.includes('123456') && otp.text.includes('Your code: 123456') && !otp.html.includes('/auth/v1/verify'), 'a code e-mail shows the code and no link');
check(renderAuthEmail(mk('reauthentication'), SUPA)!.html.includes('123456'), 'a reauthentication e-mail shows the code');
check(renderAuthEmail(mk('email', null, { token: '' }), SUPA) === null, 'a code e-mail without a code is refused');
check(renderAuthEmail(mk('email_change'), SUPA) === null && renderAuthEmail(mk('something_new'), SUPA) === null, 'unsupported types are not guessed');
const evil = renderAuthEmail(mk('signup', { candidate_portal: true, name: '<img src=x onerror=alert(1)>"' }), SUPA)!;
check(!evil.html.includes('<img') && evil.html.includes('&lt;img'), 'a hostile name is escaped in the HTML');

// ---- the request handler (fake mail) ---------------------------------------------------------------------------------------------
const settings = (over: Partial<AutomationSettings['email']> = {}): AutomationSettings => ({
  mode: 'dry_run',
  email: { provider: 'smtp', apiKey: null, smtp: { host: 'h', port: 465, secure: true, user: 'u', pass: 'p' }, apiBaseUrl: null, fromName: 'Amuwa Corporation', fromEmail: 'meta@amuwa.com', replyTo: 'meta@amuwa.com', cc: ['cc@example.com'], bcc: ['audit@example.com'], ...over },
  whatsapp: { webhookUrl: null, source: 's' }, testRecipients: { emails: new Set(['nobody@example.com']), phones: new Set() }, requireValidWhatsapp: false,
  appUrl: null, secretKey: null, dispatchSecrets: []
});
function signed(payload: unknown, opts: { id?: string; at?: number; secretKey?: Buffer } = {}) {
  const b = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const id = opts.id ?? 'msg_test';
  const t = String(Math.floor((opts.at ?? NOW) / 1000));
  return { body: b, id, timestamp: t, signature: `v1,${signHook(opts.secretKey ?? key, id, t, b)}` };
}
type Sent = { settings: AutomationSettings; to: { email: string; name: string }; mail: { subject: string; html: string; text: string } };
function fake(ok = true, retry = true) {
  const sent: Sent[] = [];
  const deps = {
    settings: () => settings(), supabaseUrl: () => SUPA, secret: () => SECRET, now: () => NOW,
    send: (async (s: AutomationSettings, to: Sent['to'], mail: Sent['mail']) => { sent.push({ settings: s, to, mail }); return { ok, retry, code: ok ? 250 : 451, ref: null, detail: ok ? 'SMTP 250' : 'SMTP error 451: secret-detail' }; }) as never
  };
  return { sent, deps };
}

{
  const f = fake();
  const r = await handleAuthEmailHook(signed(mk('signup')), f.deps);
  check(r.status === 200 && Object.keys(r.body).length === 0, 'a valid sign-up request is answered 200 with {}', r);
  check(f.sent.length === 1 && f.sent[0].to.email === 'asha@example.com' && f.sent[0].mail.subject === 'Confirm your email – Amuwa Careers', 'the e-mail is sent once, to the user');
  check(f.sent[0].settings.email.cc.length === 0 && f.sent[0].settings.email.bcc.length === 0, 'the CRM\'s CC / BCC lists are NOT applied to a one-time link');
  check(f.sent[0].settings.email.fromName === 'Amuwa Careers', 'a candidate\'s e-mail is sent as "Amuwa Careers"');
  check(f.sent[0].settings.mode === 'dry_run', 'the sending mode of the onboarding automation (dry_run here) does not stop auth e-mails');
}
{
  const f = fake();
  await handleAuthEmailHook(signed(mk('recovery', {})), f.deps);
  check(f.sent[0].settings.email.fromName === 'Amuwa Corporation', 'a staff e-mail keeps the CRM\'s sender name');
}
{
  const f = fake();
  const r = await handleAuthEmailHook(signed(mk('signup')), { ...f.deps, secret: () => undefined });
  check(r.status === 503 && f.sent.length === 0, 'no hook secret configured: refused, nothing sent');
}
{
  const f = fake();
  const bad = signed(mk('signup'), { secretKey: hookKey(`v1,whsec_${Buffer.from('some-other-secret-0123456789ab').toString('base64')}`)! });
  const r = await handleAuthEmailHook(bad, f.deps);
  check(r.status === 401 && f.sent.length === 0, 'a bad signature: 401, nothing sent', r);
  const stale = await handleAuthEmailHook(signed(mk('signup'), { at: NOW - 3_600_000 }), f.deps);
  check(stale.status === 401 && f.sent.length === 0, 'a stale (replayed) request: 401, nothing sent');
  const nosig = await handleAuthEmailHook({ body: JSON.stringify(mk('signup')) }, f.deps);
  check(nosig.status === 401 && f.sent.length === 0, 'an unsigned request: 401, nothing sent');
  const huge = await handleAuthEmailHook(signed('x'.repeat(30_000)), f.deps);
  check(huge.status === 413 && f.sent.length === 0, 'an oversized request: 413');
}
{
  const f = fake();
  const notJson = await handleAuthEmailHook(signed('not json'), f.deps);
  const noEmail = await handleAuthEmailHook(signed({ user: { email: 'nope' }, email_data: { email_action_type: 'signup' } }), f.deps);
  check(notJson.status === 400 && noEmail.status === 400 && f.sent.length === 0, 'a malformed payload (signed) is 400, nothing sent');
  const change = await handleAuthEmailHook(signed(mk('email_change')), f.deps);
  check(change.status === 422 && f.sent.length === 0, 'an unsupported type is 422 (an honest refusal), nothing sent');
}
{
  const f = fake(false, true);
  const r = await handleAuthEmailHook(signed(mk('signup')), f.deps);
  check(r.status === 503 && !JSON.stringify(r.body).includes('secret-detail') && !JSON.stringify(r.body).includes('hash_abc'), 'a temporary mail failure: 503 without provider detail or the token');
  const g = fake(false, false);
  check((await handleAuthEmailHook(signed(mk('signup')), g.deps)).status === 502, 'a permanent mail failure: 502');
  const boom = { ...fake().deps, send: (async () => { throw new Error('socket exploded with hash_abc'); }) as never };
  const b = await handleAuthEmailHook(signed(mk('signup')), boom);
  check(b.status === 503 && !JSON.stringify(b.body).includes('exploded'), 'a thrown error is contained: 503, no internals');
}

// ---- end to end: signed HTTP request -> the API -> real nodemailer -> a local mail server --------------------------------------------
const received: string[] = [];
const rcpt: string[] = [];
const smtp: Server = createServer(socket => {
  let data = false;
  let buf = '';
  socket.write('220 test ESMTP\r\n');
  socket.on('data', chunk => {
    buf += chunk.toString('latin1');
    for (;;) {
      if (data) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end < 0) return;
        received.push(buf.slice(0, end));
        buf = buf.slice(end + 5);
        data = false;
        socket.write('250 queued\r\n');
        continue;
      }
      const nl = buf.indexOf('\r\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      if (/^EHLO/i.test(line)) socket.write('250-test\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH PLAIN/i.test(line)) socket.write('235 ok\r\n');
      else if (/^RCPT TO/i.test(line)) { rcpt.push(line); socket.write('250 ok\r\n'); }
      else if (/^DATA/i.test(line)) { data = true; socket.write('354 go\r\n'); }
      else if (/^QUIT/i.test(line)) { socket.write('221 bye\r\n'); socket.end(); return; }
      else socket.write('250 ok\r\n');
    }
  });
});
await new Promise<void>(res => smtp.listen(0, '127.0.0.1', res));
const port = (smtp.address() as { port: number }).port;
Object.assign(process.env, {
  SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon', SUPABASE_AUTH_HOOK_SECRET: SECRET,
  EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', SMTP_USER: 'meta@amuwa.com', SMTP_PASS: 'app-password',
  EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>', EMAIL_BCC: 'audit@example.com', EMAIL_CC: 'cc@example.com', AUTOMATION_MODE: 'dry_run'
});
const { app } = await import('../../server/app.js');
const post = (payload: unknown, tweak: (h: Record<string, string>) => void = () => undefined) => {
  const b = JSON.stringify(payload);
  const id = 'msg_e2e';
  const t = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': t, 'webhook-signature': `v1,${createHmac('sha256', KEY_BYTES).update(`${id}.${t}.${b}`).digest('base64')}` };
  tweak(headers);
  return app.request('/api/v1/internal/auth/email-hook', { method: 'POST', headers, body: b });
};
{
  const res = await post(mk('signup'));
  check(res.status === 200 && JSON.stringify(await res.json()) === '{}', 'end to end: Supabase gets 200 {}', res.status);
  check(received.length === 1, 'end to end: one message reached the mail server', received.length);
  const raw = received[0] ?? '';
  // header values with non-ASCII characters (the dash in the subject) arrive RFC 2047 encoded and folded: unfold and decode them
  const header = raw.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ').replace(/\?= =\?UTF-8\?Q\?/g, '').replace(/=\?UTF-8\?Q\?(.*?)\?=/g, (_m, q: string) =>
    Buffer.from(q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
  check(/Subject: Confirm your email/.test(header) && /To: .*asha@example\.com/.test(header) && /From: .*Amuwa Careers.*meta@amuwa\.com/.test(header), 'end to end: subject, recipient and sender name are right', header);
  check(rcpt.length === 1 && /asha@example\.com/.test(rcpt[0]), 'end to end: the only recipient is the user (no CC / BCC copy of the link)', rcpt);
  check(!/audit@example\.com|cc@example\.com/.test(raw), 'end to end: the configured BCC / CC addresses do not appear anywhere in the message');
  check(/auth\/v1\/verify\?token=hash_abc/.test(raw.replace(/=\r\n/g, '').replace(/=3D/g, '=')), 'end to end: the message carries the confirmation link');
  const rejected = await post(mk('signup'), h => { h['webhook-signature'] = 'v1,AAAA'; });
  check(rejected.status === 401 && received.length === 1, 'end to end: a bad signature is 401 and sends nothing', rejected.status);
  const none = await post(mk('signup'), h => { delete h['webhook-id']; });
  check(none.status === 401 && received.length === 1, 'end to end: missing webhook headers are 401 and send nothing');
}
smtp.close();

console.log(`\n${passed} AUTH E-MAIL HOOK CHECKS PASSED`);
process.exit(0);
