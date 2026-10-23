/**
 * The BolifyAI webhook sender (server/automations/bolify.ts): the request is exactly the five fields of the Google Sheet script,
 * a 2xx is "accepted", busy/unavailable is retried, a refused request is not, and staging allow-lists and bad numbers never reach the webhook.
 */
import { BolifyWebhookSender, bolifyConfig, bolifyPayload, bolifyPhone, bolifySender, type BolifyFetch } from '../../server/automations/bolify.js';
import type { ReminderCall } from '../../server/automations/subscriptionReminders.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const call: ReminderCall = {
  id: 'rem-1', attempts: 1, stage: 3, expiryDate: '2026-11-01', daysLeft: 3, phone: '+919820000123', customerId: 'c1',
  firstName: 'Meera', lastName: 'Joshi', company: 'Joshi Sweets', email: 'meera@joshi.example', location: 'Pune',
  serviceCode: 'AI_CALLING', serviceName: 'AI Calling', planName: 'Gold'
};
const cfg = (over: Partial<ReturnType<typeof bolifyConfig>> = {}) => ({ ...bolifyConfig({ BOLIFY_WEBHOOK_URL: 'https://hooks.example.test/bolify' } as any), ...over });
function fake(status: number, body = '', onCall?: (url: string, init: any) => void): BolifyFetch {
  return async (url, init) => {
    onCall?.(url, init);
    return { status, text: async () => body };
  };
}

// configuration
check(bolifyConfig({} as any).webhookUrl === null, 'no BOLIFY_WEBHOOK_URL: no sender, nothing can be called');
check(bolifySender({} as any) === null && bolifySender({ BOLIFY_WEBHOOK_URL: 'https://hooks.example.test/x' } as any) !== null, 'the sender exists only when the webhook is set');
check(bolifyConfig({ BOLIFY_WEBHOOK_URL: 'http://hooks.example.test/x' } as any).webhookUrl === null, 'a plain http address is refused');
check(bolifyConfig({ BOLIFY_WEBHOOK_URL: 'http://127.0.0.1:9/x' } as any).webhookUrl !== null, 'http is allowed for a local test server');
check(bolifyConfig({ BOLIFY_WEBHOOK_URL: 'not a url' } as any).webhookUrl === null, 'a garbage address is refused');
check(bolifyConfig({ BOLIFY_TIMEOUT_MS: '5' } as any).timeoutMs === 10_000 && bolifyConfig({ BOLIFY_TIMEOUT_MS: '20000' } as any).timeoutMs === 20_000, 'the timeout is sane');

// the request
check(bolifyPhone('9820000123') === '+919820000123' && bolifyPhone('09820000123', '91') === '919820000123' && bolifyPhone('+91 98200 00123', '10') === '9820000123', 'the number is written in the chosen format');
check(bolifyPhone('12345') === '' && bolifyPhone('') === '' && bolifyPhone(null) === '', 'a number that is not an Indian mobile gives nothing');
const body = bolifyPayload(call);
check(JSON.stringify(Object.keys(body)) === JSON.stringify(['name', 'phone', 'email', 'service', 'location']), 'the request has exactly the five fields of the sheet script', body);
check(body.name === 'Meera Joshi' && body.phone === '+919820000123' && body.email === 'meera@joshi.example' && body.service === 'AI Calling' && body.location === 'Pune', 'and their values', body);
check(bolifyPayload({ ...call, email: null, location: null, serviceName: null }).email === '' && bolifyPayload({ ...call, serviceName: null }).service === 'AI_CALLING', 'missing e-mail / city are empty strings; the service falls back to its code');
const ctx = bolifyPayload(call, true);
check(ctx.reference === 'rem-1' && ctx.expiry_date === '2026-11-01' && ctx.days_left === 3 && ctx.reminder_stage === 3, 'the context fields are added only on request');

// outcomes
let seen: { url: string; init: any } | null = null;
let r = await new BolifyWebhookSender(cfg(), fake(200, '{"call_id":"CALL-77"}', (url, init) => (seen = { url, init }))).place(call);
check(r.outcome === 'ACCEPTED' && r.callId === 'CALL-77' && r.code === 200, 'a 2xx is accepted, and the call id is kept when the reply has one', r);
check(seen!.url === 'https://hooks.example.test/bolify' && seen!.init.method === 'POST' && seen!.init.headers['content-type'] === 'application/json' && !seen!.init.headers.authorization, 'it posts JSON to the webhook with no key unless one is set');
check(JSON.parse(seen!.init.body).phone === '+919820000123', 'the body is the JSON payload');
r = await new BolifyWebhookSender(cfg({ apiKey: 'k-secret' }), fake(204, '', (_u, init) => (seen = { url: _u, init }))).place(call);
check(r.outcome === 'ACCEPTED' && r.callId === null && seen!.init.headers.authorization === 'Bearer k-secret', 'an empty 2xx is accepted; the key goes in the Authorization header when set');
r = await new BolifyWebhookSender(cfg(), fake(200, 'ok')).place(call);
check(r.outcome === 'ACCEPTED' && r.callId === null, 'a plain-text reply is accepted too');
for (const st of [408, 429, 500, 503]) {
  r = await new BolifyWebhookSender(cfg(), fake(st, 'busy')).place(call);
  check(r.outcome === 'RETRY' && r.code === st, `HTTP ${st} is tried again later`, r);
}
for (const st of [400, 401, 403, 404, 422]) {
  r = await new BolifyWebhookSender(cfg(), fake(st, '{"error":"bad phone 9820000123"}')).place(call);
  check(r.outcome === 'FAILED' && r.code === st && !r.detail.includes('9820000123'), `HTTP ${st} is a refusal: failed, not retried, and the reply is not copied into the record`, r);
}
r = await new BolifyWebhookSender(cfg(), async () => { throw new Error('ECONNRESET'); }).place(call);
check(r.outcome === 'RETRY' && !/ECONNRESET/.test(r.detail), 'a network error is retried and its text is not stored', r);
r = await new BolifyWebhookSender(cfg({ timeoutMs: 1000 }), (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))).place(call);
check(r.outcome === 'RETRY' && /did not answer/.test(r.detail), 'a webhook that never answers times out and is retried');

// nothing reaches the webhook for a bad number, a missing URL, or outside the staging allow-list
let hits = 0;
const counting = fake(200, '', () => hits++);
r = await new BolifyWebhookSender(cfg(), counting).place({ ...call, phone: '12345' });
check(r.outcome === 'FAILED' && hits === 0, 'an invalid number never reaches the webhook');
r = await new BolifyWebhookSender(cfg({ webhookUrl: null }), counting).place(call);
check(r.outcome === 'FAILED' && hits === 0, 'with no webhook configured nothing is sent');
process.env.AUTOMATION_TEST_RECIPIENTS = '9811122233';
r = await new BolifyWebhookSender(cfg(), counting).place(call);
check(r.outcome === 'SKIPPED' && hits === 0, 'with a staging allow-list, a number outside it is skipped and never called', r);
r = await new BolifyWebhookSender(cfg(), counting).place({ ...call, phone: '+919811122233' });
check(r.outcome === 'ACCEPTED' && hits === 1, 'a number on the allow-list is called');
delete process.env.AUTOMATION_TEST_RECIPIENTS;

// on demand (Technical Consultant)
let sent: any = null;
r = await new BolifyWebhookSender(cfg(), fake(200, '', (_u, init) => (sent = JSON.parse(init.body)))).callCustomer(
  { name: 'Ravi Kumar', phone: '9820000456', whatsapp: null, email: 'ravi@x.example', city: 'Nashik' }, ['AI Calling', 'WhatsApp API']);
check(r.outcome === 'ACCEPTED' && sent.name === 'Ravi Kumar' && sent.phone === '+919820000456' && sent.service === 'AI Calling, WhatsApp API' && sent.location === 'Nashik' && sent.email === 'ravi@x.example', 'one customer on demand: the same five fields, services joined', sent);
r = await new BolifyWebhookSender(cfg(), counting).callCustomer({ name: 'No Phone', phone: null, whatsapp: '9820000789', email: null, city: null }, []);
check(r.outcome === 'ACCEPTED' && hits === 2, 'the WhatsApp number is used when there is no phone number');

console.log(`=== ${passed} checks passed`);
