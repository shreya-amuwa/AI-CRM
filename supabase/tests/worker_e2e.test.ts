/**
 * The Cloudflare Worker end to end in the real Workers runtime (wrangler dev runs workerd, the runtime of production), against
 * PostgreSQL + PostgREST through the local Supabase gateway. Run via supabase/tests/run-worker.sh (npm run test:worker).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { decryptSecret } from '../../server/automations/secrets.js';
import { presignUrl, signRequest } from '../../server/storage/sigv4.js';
import { renderInvoicePdf } from '../../server/invoices/pdf.js';
import { renderNdaPdf } from '../../server/hrDocuments/render.js';
import { signHook } from '../../server/automations/authEmailHook.js';
import { SECURITY_HEADERS } from '../../worker/securityHeaders.js';
import { sampleInvoice } from './invoice_fixtures.js';
import { mimePart, startFakeSmtp } from './fake-smtp.js';
import { PROBE_NOW } from './worker_probe_inputs.js';

let passed = 0;
const children: ChildProcess[] = [];
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    for (const c of children) c.kill();
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const SECRET = process.env.JWT_SECRET!;
const sign = (payload: Record<string, unknown>) => {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...payload });
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
};
const freePort = () =>
  new Promise<number>(resolve => {
    const s = createNetServer();
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Starts `wrangler dev` and waits until it answers. Its output is collected (the cron run logs a line). */
async function startWorker(args: string[], port: number): Promise<{ output: () => string }> {
  let out = '';
  const child = spawn('npx', ['wrangler', 'dev', ...args, '--port', String(port), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);
  child.stdout!.on('data', d => (out += d));
  child.stderr!.on('data', d => (out += d));
  for (let i = 0; i < 240; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return { output: () => out };
    } catch {
      await sleep(500);
    }
  }
  console.error(out);
  throw new Error('wrangler dev did not start');
}

// ---- a stand-in for AWS SES (API v2): checks each request's signature as AWS does and records the e-mail; an e-mail to quota@... gets
// SES's "daily quota exceeded" refusal ---------------------------------------------------------------------------------------------------
const SES_KEY = { id: 'AKIAWORKERTEST', secret: 'worker/ses+SECRET' };
const mails: { signed: boolean; body: any }[] = [];
const sesServer = createHttpServer((req, res) => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    const date = String(req.headers['x-amz-date'] || '');
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`;
    const port = (sesServer.address() as { port: number }).port;
    const expected = signRequest({
      method: 'POST', url: `http://127.0.0.1:${port}/v2/email/outbound-emails`, service: 'ses', region: 'ap-south-1', accessKeyId: SES_KEY.id,
      secretAccessKey: SES_KEY.secret, headers: { 'content-type': String(req.headers['content-type']) }, body: b, now: new Date(iso)
    }).authorization;
    if (JSON.stringify(body.Destination ?? '').includes('quota@')) {
      res.writeHead(429, { 'content-type': 'application/json', 'x-amzn-errortype': 'TooManyRequestsException:' });
      return res.end('{"message":"Daily message quota exceeded."}');
    }
    if (req.method === 'POST' && req.url === '/v2/email/outbound-emails') mails.push({ signed: req.headers.authorization === expected, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ MessageId: `ses-${mails.length}` }));
  });
});
// ---- the meta@amuwa.com mailbox (SMTP), reached from the Worker through Cloudflare's TCP sockets (the SES fallback) ------------
const mailbox = await startFakeSmtp({ mode: 'plain', user: 'meta@amuwa.com', pass: 'app-password' });
await new Promise<void>(r => sesServer.listen(0, '127.0.0.1', r));
const sesUrl = `http://127.0.0.1:${(sesServer.address() as { port: number }).port}`;

// ---- the Worker's settings (what the owner sets as Worker secrets / variables in production) ------------------------------------
const HOOK_KEY = Buffer.from('0123456789abcdef0123456789abcdef');
const settings: Record<string, string> = {
  SUPABASE_URL: process.env.GATEWAY_URL!,
  SUPABASE_ANON_KEY: sign({ role: 'anon' }),
  SUPABASE_SERVICE_ROLE_KEY: sign({ role: 'service_role' }),
  WEBHOOK_SECRET: 'webhook-secret-0123456789',
  WEBHOOK_VERIFY_TOKEN: 'verify-me',
  CRON_SECRET: 'cron-secret-0123456789abcdef',
  SCHEDULED_ENABLED: 'true',
  PORTAL_FORWARD_SECRET: 'portal-forward-secret-worker-0123456789abc',
  EMAIL_PROVIDER: 'ses',
  SES_REGION: 'ap-south-1',
  SES_ACCESS_KEY_ID: SES_KEY.id,
  SES_SECRET_ACCESS_KEY: SES_KEY.secret,
  SES_MAX_PER_SECOND: '100',
  EMAIL_API_BASE_URL: sesUrl,
  EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(mailbox.port),
  SMTP_SECURE: 'false',
  SMTP_USER: 'meta@amuwa.com',
  SMTP_PASS: 'app-password',
  SUPABASE_AUTH_HOOK_SECRET: `v1,whsec_${HOOK_KEY.toString('base64')}`,
  RESEND_MAX_PER_SECOND: '100',
  AUTOMATION_MODE: 'dry_run',
  API_ACCESS_LOG: 'off'
};
const varsFile = join(process.env.WORK_DIR!, 'worker.vars');
writeFileSync(varsFile, Object.entries(settings).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n');

const [appPort, probePort] = [await freePort(), await freePort()];
const worker = await startWorker(['--env-file', varsFile], appPort);
await startWorker(['supabase/tests/worker_probe.ts'], probePort);
const base = `http://127.0.0.1:${appPort}`;

// ---- 1. Node.js-dependent server code: the same results inside the Workers runtime as in Node.js -------------------------------
{
  const p = (await (await fetch(`http://127.0.0.1:${probePort}/__probe`)).json()) as any;
  check(!p.error, 'the probe ran inside the Workers runtime', p.error);
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  check(p.aesRoundTrip === 'Client-Pass-123' && p.aesWrongKey === null, 'AES-256-GCM (the client password kept for the completion e-mail) encrypts and decrypts');
  check(decryptSecret(null, null) === null && p.password && p.uuid, 'random passwords and ids are made');
  const presigned = presignUrl({ method: 'GET', host: 'acc.r2.cloudflarestorage.com', path: '/bucket/customer-documents/a b.pdf', accessKeyId: 'AKID', secretAccessKey: 'SECRET', expiresSeconds: 300, now: new Date(PROBE_NOW) });
  check(p.presigned === presigned, 'R2 signed links are identical to Node.js (file uploads and downloads keep working)');
  check(p.invoicePdf === sha((await renderInvoicePdf(sampleInvoice(7), { stage: 'PAID' })).bytes), 'invoice PDFs are byte-identical to Node.js');
  check(p.ndaPdf === sha(await renderNdaPdf({ letterDate: '2026-09-11', employeeName: 'Priya Sharma' })), 'HR document PDFs are byte-identical to Node.js');
  check(p.hookSignature === signHook(HOOK_KEY, 'msg_1', '1700000000', '{"a":1}') && p.hookVerifies === true, 'Supabase hook signatures (HMAC) match and verify');
  check(p.asyncContext === 'req-42', 'the per-request context (request id in audit rows) survives an await');
  check(p.smtp.ok === false && p.smtp.retry === true && /worker\/entry\.ts/.test(p.smtp.detail), 'a Worker started without the socket connector: a clear SMTP failure, kept for a retry, never a crash', p.smtp);
}

// ---- 2. static files and the single-page app ----------------------------------------------------------------------------------
{
  let r = await fetch(`${base}/`);
  const html = await r.text();
  check(r.status === 200 && /<div id="root">/.test(html), 'the home page is served', r.status);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) check(r.headers.get(name) === value, `static files carry ${name} (public/_headers)`);
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  r = await fetch(`${base}${script}`);
  check(script && r.status === 200 && r.headers.get('cache-control') === 'public, max-age=31536000, immutable', 'built scripts are cached for a year', { script, cc: r.headers.get('cache-control') });
  r = await fetch(`${base}/hr/employees/123`);
  check(r.status === 200 && /<div id="root">/.test(await r.text()) && r.headers.get('content-security-policy') === SECURITY_HEADERS['Content-Security-Policy'], 'a deep link to an app screen gets the app, with the security headers');
  r = await fetch(`${base}/assets/no-such-file-abc123.js`);
  check(r.status === 404, 'a missing script is 404, not the app page');
  r = await fetch(`${base}/documentation/`);
  check(r.status === 200 && /<html/i.test(await r.text()), 'the documentation site is served');
  // The Privacy Policy and Terms of Service (Google's sign-in consent screen links to them): public, readable without any script.
  for (const [path, title] of [['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Service']]) {
    r = await fetch(`${base}${path}/`);
    const page = await r.text();
    check(r.status === 200 && page.includes(`<h1>${title}</h1>`) && !/<script/i.test(page) && r.headers.get('x-frame-options') === 'DENY', `${path}/ serves the ${title}, without scripts, with the security headers`);
    r = await fetch(`${base}${path}`);
    check(r.status === 200 && r.url.endsWith(`${path}/`) && (await r.text()).includes(`<h1>${title}</h1>`), `${path} (no closing slash) reaches the ${title}`, { url: r.url, status: r.status });
  }
  r = await fetch(`${base}/privacy/`);
  check((await r.text()).includes('Limited Use requirements'), 'the Privacy Policy carries Google\'s Limited Use statement');
}

// ---- 3. the API against the database ------------------------------------------------------------------------------------------
const db = new pg.Pool();
{
  let r = await fetch(`${base}/api/v1/health`);
  let j = (await r.json()) as any;
  check(r.status === 200 && j.data.status === 'ok' && /^ok/.test(j.data.checks.database) && j.data.checks.serviceRoleKey === 'configured', 'health: the Worker reaches the database, all settings present', j);
  r = await fetch(`${base}/api/v1/me`);
  j = await r.json();
  check(r.status === 401 && j.error.code === 'UNAUTHENTICATED', 'no token: 401 envelope', j);
  const { rows: [sa] } = await db.query(
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
     values ('root-worker@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}') returning id`);
  const token = sign({ sub: sa.id, role: 'authenticated' });
  r = await fetch(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  j = await r.json();
  check(r.status === 200 && j.data.role === 'SUPER_ADMIN' && r.headers.get('x-request-id'), 'signed in: the profile comes from the database', j);
  r = await fetch(`${base}/api/v1/departments`, { headers: { authorization: `Bearer ${token}` } });
  j = await r.json();
  check(r.status === 200 && j.data.length >= 12, 'departments come from the database');

  // ---- 3b. abuse protection inside the Workers runtime: the portal's signed visitor address, the database-backed limits, throwaway domains
  {
    const SECRET = settings.PORTAL_FORWARD_SECRET;
    const signedFor = (ip: string) => {
      const t = Math.floor(Date.now() / 1000);
      return { 'x-portal-client-ip': ip, 'x-portal-client-ts': String(t), 'x-portal-client-sig': createHmac('sha256', SECRET).update(`${ip}.${t}`).digest('hex') };
    };
    const guard = (ip: string, email: string) => fetch(`${base}/api/v1/candidate-auth/guard`, { method: 'POST', headers: { 'content-type': 'application/json', ...signedFor(ip) }, body: JSON.stringify({ action: 'reset', email }) });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await guard('203.0.113.77', `w${i}@example.com`)).status);
    check(codes.slice(0, 5).every(c => c === 200) && codes[5] === 429, 'Worker: reset guard limited per (signed) visitor, counted in the database', codes);
    check((await guard('203.0.113.78', 'x@example.com')).status === 200, 'Worker: another visitor is not affected');
    const reg = await fetch(`${base}/api/v1/candidate-auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...signedFor('203.0.113.79') }, body: JSON.stringify({ name: 'Temp', email: 'a@mailinator.com', phone: '9876543210', password: 'Very-long-pass-1' }) });
    check(reg.status === 422, 'Worker: a throwaway sign-up address is refused');
  }

  // ---- 4. /api/proxy: signed-in users only, never an internal address
  r = await fetch(`${base}/api/proxy?url=${encodeURIComponent('https://example.com/')}`);
  check(r.status === 401, '/api/proxy without a token: 401');
  for (const target of ['http://127.0.0.1:5432/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'file:///etc/passwd']) {
    r = await fetch(`${base}/api/proxy?url=${encodeURIComponent(target)}`, { headers: { authorization: `Bearer ${token}` } });
    check(r.status === 400, `/api/proxy refuses ${target}`, r.status);
  }

  // ---- 5. the inbound lead webhook
  r = await fetch(`${base}/api/webhooks/wabastore/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Intruder"}' });
  check(r.status === 401, 'webhook without the secret: 401');
  r = await fetch(`${base}/api/webhooks/wabastore/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': settings.WEBHOOK_SECRET },
    body: JSON.stringify({ name: 'Worker Lead', phone: '9876543210', email: 'lead@example.com', message: 'From the Worker' })
  });
  j = await r.json();
  check(r.status === 200 && j.success && j.lead?.name === 'Worker Lead', 'webhook with the secret stores the lead', j);
  const { rows: leads } = await db.query(`select name, channel, department from public.crm_leads where name = 'Worker Lead'`);
  check(leads.length === 1 && leads[0].channel === 'whatsapp' && leads[0].department === 'wabastore', 'the lead is in the database', leads);
  r = await fetch(`${base}/api/webhooks/nosuchdept/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.WEBHOOK_SECRET}` }, body: '{"name":"Ghost"}' });
  check(r.status === 404, 'webhook for an unknown department: 404');
  r = await fetch(`${base}/api/webhook?hub.challenge=ch4ll3nge&hub.verify_token=verify-me`);
  check(r.status === 200 && (await r.text()) === 'ch4ll3nge', 'Meta subscription handshake');

  // ---- 6. e-mail through AWS SES: the Supabase auth e-mail hook, signed as Supabase signs it
  const body = JSON.stringify({
    user: { email: 'asha@example.com', user_metadata: {} },
    email_data: { token: '123456', token_hash: 'hash_abc', redirect_to: 'https://crm.amuwacorporation.com/', email_action_type: 'recovery' }
  });
  const id = 'msg_worker';
  const ts = String(Math.floor(Date.now() / 1000));
  r = await fetch(`${base}/api/v1/internal/auth/email-hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${signHook(HOOK_KEY, id, ts, body)}` },
    body
  });
  check(r.status === 200 && JSON.stringify(await r.json()) === '{}', 'auth e-mail hook: Supabase gets 200 {}');
  check(mails.length === 1, 'one e-mail reached SES', mails.length);
  const m = mails[0];
  check(m.signed, 'the Worker signs the SES request so that AWS can verify it (node:crypto inside the Workers runtime)');
  const simple = m.body.Content?.Simple;
  check(JSON.stringify(m.body.Destination.ToAddresses) === '["asha@example.com"]' && /<meta@amuwa\.com>$/.test(m.body.FromEmailAddress) && simple?.Subject?.Data && /hash_abc/.test(simple?.Body?.Html?.Data) && simple?.Body?.Text?.Data, 'recipient, sender, subject, HTML and text are right', m.body);
  r = await fetch(`${base}/api/v1/internal/auth/email-hook`, { method: 'POST', headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': 'v1,AAAA' }, body });
  check(r.status === 401 && mails.length === 1, 'a forged hook request is refused and sends nothing');

  // ---- 6b. SES's daily quota reached: the same e-mail goes out through the meta@amuwa.com mailbox (SMTP over Cloudflare sockets)
  const quotaBody = body.replace('asha@example.com', 'quota@example.com');
  const qid = 'msg_worker_quota';
  r = await fetch(`${base}/api/v1/internal/auth/email-hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': qid, 'webhook-timestamp': ts, 'webhook-signature': `v1,${signHook(HOOK_KEY, qid, ts, quotaBody)}` },
    body: quotaBody
  });
  check(r.status === 200 && JSON.stringify(await r.json()) === '{}', 'SES over its quota: Supabase still gets 200 {}');
  check(mails.length === 1 && mailbox.mails.length === 1, 'the e-mail went out through the SMTP mailbox instead', { ses: mails.length, smtp: mailbox.mails.length });
  const fb = mailbox.mails[0];
  check(fb.from === 'meta@amuwa.com' && JSON.stringify(fb.rcpts) === '["quota@example.com"]' && /^From: .*<meta@amuwa\.com>$/m.test(fb.data) && /hash_abc/.test(mimePart(fb.data, 'text/html; charset=utf-8') ?? ''), 'sender, recipient and the reset link are right in the fallback e-mail', fb.data.slice(0, 500));

  // ---- 7. the cron: the scheduled run reaches the automations, authenticated with CRON_SECRET
  r = await fetch(`${base}/api/v1/internal/automations/dispatch`, { method: 'POST' });
  check(r.status === 401, 'the dispatch endpoint refuses a caller without the secret');
  r = await fetch(`${base}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('30 3 * * *')}`);
  check(r.status === 200, 'the scheduled event was accepted', r.status);
  let logged = false;
  for (let i = 0; i < 120 && !logged; i++) {
    logged = /\[cron\] automations dispatched: HTTP 200/.test(worker.output());
    if (!logged) await sleep(500);
  }
  check(logged, 'the cron run completed the automations dispatch (HTTP 200)', worker.output().slice(-2000));
}

await db.end();
sesServer.close();
await mailbox.close();
for (const c of children) c.kill();
console.log(`\n=== ${passed} CLOUDFLARE WORKER END-TO-END CHECKS PASSED ===`);
process.exit(0);
