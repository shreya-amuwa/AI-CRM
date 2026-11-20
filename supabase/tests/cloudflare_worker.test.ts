/**
 * The Cloudflare Workers deployment, without the Workers runtime (Node.js; the runtime itself is checked by npm run test:worker):
 * the security headers of static files and of Worker responses match, the caller's address and place can only come from Cloudflare,
 * the (req, res) adapter of /api/proxy and the lead webhook, the request routing, the cron schedule, and Resend's rate limit handling.
 * Run: npm run test:unit
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { SECURITY_HEADERS, withSecurityHeaders } from '../../worker/securityHeaders.js';
import { runNodeStyleHandler } from '../../worker/nodeHandler.js';
import { SMTP_UNAVAILABLE } from '../../worker/stubs/nodemailer.js';
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

// ---- static files and Worker responses carry the same security headers -------------------------------------------------------
{
  const lines = readFileSync('public/_headers', 'utf8').split('\n');
  const block: Record<string, string> = {};
  let inAll = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inAll = line.trim() === '/*';
    else if (inAll && line.trim()) {
      const i = line.indexOf(':');
      block[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  check(JSON.stringify(block) === JSON.stringify(SECURITY_HEADERS), 'public/_headers "/*" equals worker/securityHeaders.ts', { block, SECURITY_HEADERS });
  check(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/.test(lines.join('\n')), 'built assets are cached for a year (immutable file names)');
  const kept = withSecurityHeaders(new Response('x', { headers: { 'Content-Security-Policy': "default-src 'none'; sandbox" } }));
  check(kept.headers.get('content-security-policy') === "default-src 'none'; sandbox" && kept.headers.get('x-frame-options') === 'DENY', 'a stricter policy set by a handler is kept; the others are added');
}

// ---- the caller's address and place: only Cloudflare's own values ------------------------------------------------------------
// worker/index.ts imports the whole API; give it the configuration it reads when loaded.
Object.assign(process.env, { SUPABASE_URL: 'https://project.supabase.example', SUPABASE_ANON_KEY: 'anon', API_ACCESS_LOG: 'off' });
const { withPlatformHeaders, handleRequest, runScheduledDispatch, crocodialSyncDue, default: worker } = await import('../../worker/index.js');
{
  const forged = new Request('https://crm.example/api/v1/me', {
    headers: {
      'cf-connecting-ip': '203.0.113.7',
      'x-real-ip': '6.6.6.6',
      'x-forwarded-for': '7.7.7.7',
      'x-vercel-forwarded-for': '8.8.8.8',
      'x-vercel-ip-city': 'Forged',
      'cf-ipcity': 'Forged',
      'cf-region': 'Forged'
    }
  });
  Object.defineProperty(forged, 'cf', { value: { country: 'IN', region: 'Maharashtra', city: 'Navi Mumbai', latitude: '19.03', longitude: '73.02' } });
  const h = withPlatformHeaders(forged).headers;
  check(h.get('x-real-ip') === '203.0.113.7' && h.get('x-forwarded-for') === '203.0.113.7', 'x-real-ip / x-forwarded-for are replaced by the address Cloudflare saw');
  check(h.get('x-vercel-forwarded-for') === null && h.get('x-vercel-ip-city') === null, 'Vercel headers sent by the caller are dropped');
  check(h.get('cf-ipcity') === 'Navi%20Mumbai' && h.get('cf-region') === 'Maharashtra' && h.get('cf-ipcountry') === 'IN' && h.get('cf-iplatitude') === '19.03', 'the place comes from request.cf (URI-encoded), not from the caller');
  const bare = withPlatformHeaders(new Request('https://crm.example/', { headers: { 'cf-ipcity': 'Forged', 'x-real-ip': '6.6.6.6' } })).headers;
  check(bare.get('cf-ipcity') === null && bare.get('x-real-ip') === null, 'without Cloudflare data nothing the caller sent survives');
}

// ---- the (req, res) adapter --------------------------------------------------------------------------------------------------
{
  let seen: any = null;
  const echo = (req: any, res: any) => {
    seen = req;
    res.setHeader('X-Test', 'yes');
    return res.status(201).json({ ok: true });
  };
  let r = await runNodeStyleHandler(echo, new Request('https://crm.example/api/webhooks/wabastore/whatsapp?a=1&a=2&b=x', { method: 'POST', headers: { 'X-Webhook-Secret': 's' }, body: '{"name":"A"}' }));
  check(r.status === 201 && r.headers.get('x-test') === 'yes' && (await r.json()).ok === true, 'status, headers and JSON body are returned');
  check(seen.method === 'POST' && seen.url === '/api/webhooks/wabastore/whatsapp?a=1&a=2&b=x' && seen.headers['x-webhook-secret'] === 's' && seen.body === '{"name":"A"}', 'method, path, lower-case headers and the raw body reach the handler', seen);
  check(JSON.stringify(seen.query) === JSON.stringify({ a: ['1', '2'], b: 'x' }), 'a repeated query parameter is a list, as on Vercel');
  r = await runNodeStyleHandler(echo, new Request('https://crm.example/api/webhook', { method: 'POST', body: 'x'.repeat(1_000_001) }));
  check(r.status === 413, 'a body over 1 MB is refused before the handler runs');
  r = await runNodeStyleHandler((_q: any, s: any) => s.status(204).end(), new Request('https://crm.example/api/webhook', { method: 'OPTIONS' }));
  check(r.status === 204 && (await r.text()) === '', '204 has no body');
  r = await runNodeStyleHandler((_q: any, s: any) => s.status(200).send(Buffer.from('a,b\n1,2')), new Request('https://crm.example/api/proxy'));
  check((await r.text()) === 'a,b\n1,2', 'a Buffer body is sent as bytes');
  r = await runNodeStyleHandler(() => undefined, new Request('https://crm.example/api/proxy'));
  check(r.status === 500, 'a handler that never answers gives 500, not a hang');

  // the real lead webhook through the adapter: no body is "missing JSON body", exactly as on Vercel
  const { default: webhookHandler } = await import('../../api/webhook.js');
  r = await runNodeStyleHandler(webhookHandler, new Request('https://crm.example/api/webhooks/wabastore/whatsapp', { method: 'POST' }));
  check(r.status === 400 && /missing JSON body/.test((await r.json()).error), 'the lead webhook: an empty POST is "Invalid or missing JSON body"');
  r = await runNodeStyleHandler(webhookHandler, new Request('https://crm.example/api/webhook?hub.challenge=abc123'));
  check(r.status === 200 && (await r.text()) === 'abc123', 'the lead webhook: the Meta subscription handshake echoes the challenge');
}

// ---- routing ------------------------------------------------------------------------------------------------------------------
{
  const assets = { fetch: async (req: Request) => new Response(`index for ${new URL(req.url).pathname}`, { headers: { 'content-type': 'text/html' } }) };
  const env = { ASSETS: assets };
  let r = await handleRequest(new Request('https://crm.example/sales/leads?tab=1'), env);
  check(r.status === 200 && (await r.text()) === 'index for /' && r.headers.get('content-security-policy') === SECURITY_HEADERS['Content-Security-Policy'], 'an app screen gets index.html with the security headers');
  for (const p of ['/assets/missing-abc.js', '/ocr/missing.wasm', '/api/nothing', '/api']) {
    r = await handleRequest(new Request(`https://crm.example${p}`), env);
    check(r.status === 404, `${p} with no file is 404, never index.html`);
  }
  r = await handleRequest(new Request('https://crm.example/sales', { method: 'POST' }), env);
  check(r.status === 405, 'only GET / HEAD reach the app screens');
  r = await handleRequest(new Request('https://crm.example/api/v1/nothing-here'), env);
  check(r.status === 404 && (await r.json()).error.code === 'NOT_FOUND' && r.headers.get('x-frame-options'), 'the API answers its own 404 envelope, with the security headers');
  r = await handleRequest(new Request('https://crm.example/api/proxy?url=https://example.com'), env);
  check(r.status === 401, '/api/proxy needs a signed-in user');
}

// ---- the cron schedule ------------------------------------------------------------------------------------------------------
{
  const wrangler = readFileSync('wrangler.jsonc', 'utf8');
  const crons = JSON.parse(/"crons":\s*(\[[^\]]*\])/.exec(wrangler)![1]);
  check(JSON.stringify(crons) === JSON.stringify(['30 3 * * *', '0 5 * * *', '*/5 * * * *']), 'the Worker runs the automations at the times Vercel Cron did (03:30 and 05:00 UTC), and the attendance reminders every 5 minutes', crons);
  delete process.env.CRON_SECRET;
  delete process.env.AUTOMATION_DISPATCH_SECRET;
  delete process.env.SCHEDULED_ENABLED;
  let skipped = true;
  try {
    await runScheduledDispatch({ ASSETS: { fetch: async () => new Response('') } });
  } catch {
    skipped = false;
  }
  check(skipped, 'SCHEDULED_ENABLED not set: the scheduled run does nothing (Vercel still runs the automations until go-live)');
  check(/"keep_vars":\s*true/.test(wrangler) && !/"EMAIL_PROVIDER"/.test(wrangler), 'dashboard variables survive a deploy (keep_vars) and EMAIL_PROVIDER is a dashboard setting');
  process.env.SCHEDULED_ENABLED = 'true';
  let message = '';
  try {
    await runScheduledDispatch({ ASSETS: { fetch: async () => new Response('') } });
  } catch (e) {
    message = (e as Error).message;
  }
  check(/set the CRON_SECRET/.test(message), 'a scheduled run without a dispatch secret fails loudly (visible in the Cloudflare cron log)', message);

  // the attendance reminders: the 5-minute cron calls the reminders endpoint, the two daily crons call the dispatch
  const env = { ASSETS: { fetch: async () => new Response('') } };
  const logs: string[] = [];
  const realLog = console.log;
  // the 5-minute ticks are at a fixed time so the Crocodial sync (every 15 minutes by default) runs on the one checked here: 10:15 UTC
  const run = async (cron: string, scheduledTime = Date.UTC(2026, 10, 19, 10, 15)) => {
    logs.length = 0;
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
    let error = '';
    try { await worker.scheduled({ cron, scheduledTime }, env); } catch (e) { error = (e as Error).message; } finally { console.log = realLog; }
    return { logs: logs.join('\n'), error };
  };
  delete process.env.SCHEDULED_ENABLED;
  let r = await run('*/5 * * * *');
  check(/\[cron\] reminders skipped/.test(r.logs) && !r.error, 'reminders cron is skipped unless SCHEDULED_ENABLED=true', r);
  process.env.SCHEDULED_ENABLED = 'true';
  r = await run('*/5 * * * *');
  check(/set the CRON_SECRET/.test(r.error), 'the reminders run without a dispatch secret fails loudly too', r);
  process.env.CRON_SECRET = 'cron-secret-for-the-test-0123';
  r = await run('*/5 * * * *');
  check(!r.error && /\[cron\] attendance reminders: HTTP 200/.test(r.logs) && !/automations dispatched/.test(r.logs),
    'the 5-minute cron calls the reminders endpoint (with the secret), not the daily dispatch', r);
  check(/\[cron\] crocodial sync: HTTP 200/.test(r.logs), 'the 5-minute cron also continues the Crocodial sync on its 15-minute ticks (hh:15 here)', r);
  r = await run('*/5 * * * *', Date.UTC(2026, 10, 19, 10, 20));
  check(!r.error && /\[cron\] attendance reminders: HTTP 200/.test(r.logs) && !/crocodial sync/.test(r.logs),
    'on the other 5-minute ticks (hh:20 here) only the attendance reminders run, not the Crocodial sync', r);
  delete process.env.CRON_SECRET;
  r = await run('30 3 * * *');
  check(/set the CRON_SECRET/.test(r.error) && !/reminders/.test(r.logs), 'the daily crons still call the dispatch', r);
  delete process.env.SCHEDULED_ENABLED;
}

// ---- e-mail: SMTP on Workers, Resend's rate limit ----------------------------------------------------------------------------
{
  check(/EMAIL_PROVIDER=resend/.test(SMTP_UNAVAILABLE), 'the SMTP stand-in tells what to set instead');

  const { sendEmail } = await import('../../server/automations/providers.js');
  const hits: number[] = [];
  let refuseFirst = 1;
  const mock = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      hits.push(Date.now());
      if (refuseFirst > 0) {
        refuseFirst--;
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
        return res.end('{"message":"Too many requests"}');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `email_${hits.length}` }));
    });
  });
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  const settings = {
    email: { provider: 'resend', apiKey: 're_test', smtp: null, apiBaseUrl: base, fromName: 'Amuwa', fromEmail: 'meta@amuwa.com', replyTo: 'meta@amuwa.com', cc: [], bcc: [] }
  } as unknown as AutomationSettings;
  const mail = { subject: 'S', html: '<p>H</p>', text: 'H' };

  delete process.env.RESEND_MAX_PER_SECOND;
  let res = await sendEmail(settings, { email: 'a@example.com', name: 'A' }, mail);
  check(res.ok && res.ref === 'email_2' && hits.length === 2, 'a 429 from Resend is waited out (Retry-After) and tried once more', res);
  check(hits[1] - hits[0] >= 900, 'the retry waited about as long as Resend asked', hits[1] - hits[0]);

  hits.length = 0;
  for (let i = 0; i < 3; i++) await sendEmail(settings, { email: `b${i}@example.com`, name: 'B' }, mail);
  check(hits.length === 3 && hits[2] - hits[0] >= 360, 'consecutive e-mails are spaced (5 a second by default, under Resend\'s limit)', hits.map(h => h - hits[0]));

  refuseFirst = 2;
  hits.length = 0;
  res = await sendEmail(settings, { email: 'c@example.com', name: 'C' }, mail);
  check(!res.ok && res.retry && res.code === 429 && hits.length === 2, 'still refused after one retry: kept for the next run (retry), not dropped', res);

  process.env.RESEND_MAX_PER_SECOND = '50';
  hits.length = 0;
  for (let i = 0; i < 3; i++) await sendEmail(settings, { email: `d${i}@example.com`, name: 'D' }, mail);
  check(hits[2] - hits[0] < 150, 'RESEND_MAX_PER_SECOND raises the pace for a plan that allows more', hits.map(h => h - hits[0]));
  mock.close();
}

// ---- the Crocodial sync rides on the 5-minute cron only every CROCODIAL_SYNC_EVERY_MINUTES (default 15) --------------------------------------
{
  const at = (hh: number, mm: number, ss = 0) => new Date(Date.UTC(2026, 10, 19, hh, mm, ss));
  const ticks = (env: Record<string, string>) => Array.from({ length: 12 }, (_, i) => crocodialSyncDue(at(10, i * 5), env as NodeJS.ProcessEnv)).filter(Boolean).length;
  check(ticks({}) === 4 && crocodialSyncDue(at(10, 0), {} as NodeJS.ProcessEnv) && crocodialSyncDue(at(10, 45), {} as NodeJS.ProcessEnv)
        && !crocodialSyncDue(at(10, 5), {} as NodeJS.ProcessEnv), 'crocodial sync: by default 4 of the 12 five-minute ticks an hour (:00, :15, :30, :45)');
  check(crocodialSyncDue(at(10, 15, 40), {} as NodeJS.ProcessEnv) && crocodialSyncDue(at(10, 17), {} as NodeJS.ProcessEnv), 'crocodial sync: a tick that starts a little late is still its tick');
  check(ticks({ CROCODIAL_SYNC_EVERY_MINUTES: '5' }) === 12 && ticks({ CROCODIAL_SYNC_EVERY_MINUTES: '30' }) === 2 && ticks({ CROCODIAL_SYNC_EVERY_MINUTES: '60' }) === 1,
    'crocodial sync: the interval is a setting (5, 30, 60)');
  check(ticks({ CROCODIAL_SYNC_EVERY_MINUTES: '0' }) === 0 && ticks({ CROCODIAL_SYNC_EVERY_MINUTES: 'off' }) === 0, 'crocodial sync: 0 / off never runs it from the cron');
  check(ticks({ CROCODIAL_SYNC_EVERY_MINUTES: '7' }) === 4 && ticks({ CROCODIAL_SYNC_EVERY_MINUTES: 'soon' }) === 4, 'crocodial sync: an unusable value falls back to every 15 minutes');
}

console.log(`\n${passed} CLOUDFLARE WORKER CHECKS PASSED`);
process.exit(0);
