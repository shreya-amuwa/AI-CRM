/**
 * The BolifyAI webhook sender (server/automations/bolify.ts): the request is exactly the five fields of the Google Sheet script,
 * a 2xx is "accepted", busy/unavailable is retried, a refused request is not, and staging allow-lists and bad numbers never reach the webhook.
 */
import {
  BolifyApiSender, BolifyWebhookSender, BOLIFY_DEFAULT_API_URL, BOLIFY_DEFAULT_ASSISTANT_ID, BOLIFY_DEFAULT_DIALER_ID, bolifyApiConfig, bolifyApiPayload, bolifyCallResult,
  bolifyConfig, bolifyDate, bolifyPayload, bolifyPhone, bolifySender, type BolifyFetch
} from '../../server/automations/bolify.js';
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

// ---------------------------------------------------------------------------------------------------------------------------------
// The BolifyAI calling API (x-api-key): panel recharge reminders 7, 5 and 1 day before expiry. A fake fetch only: no real call is placed.
// ---------------------------------------------------------------------------------------------------------------------------------
const KEY = 'bk_test_never_logged_1234567890';
const apiCfg = (over: Partial<ReturnType<typeof bolifyApiConfig>> = {}) => ({ ...bolifyApiConfig({ BOLIFY_API_KEY: KEY } as any), ...over });
const recharge: ReminderCall = { ...call, id: 'rem-7', stage: 7, expiryDate: '2026-11-20', daysLeft: 7 };

check(bolifyApiConfig({} as any).apiKey === null && bolifySender({} as any) === null, 'no key and no webhook: no sender, nobody can be called');
check(bolifySender({ BOLIFY_API_KEY: KEY } as any) instanceof BolifyApiSender, 'BOLIFY_API_KEY alone: the calling API');
check(bolifySender({ BOLIFY_API_KEY: KEY, BOLIFY_WEBHOOK_URL: 'https://hooks.example.test/x' } as any) instanceof BolifyWebhookSender, 'a configured webhook keeps working as before');
const dc = bolifyApiConfig({ BOLIFY_API_KEY: KEY } as any);
check(dc.apiUrl === BOLIFY_DEFAULT_API_URL && dc.assistantId === BOLIFY_DEFAULT_ASSISTANT_ID && dc.dialerId === BOLIFY_DEFAULT_DIALER_ID, 'the default endpoint, assistant and dialer');
check(bolifyApiConfig({ BOLIFY_API_KEY: KEY, BOLIFY_API_URL: 'http://api.example.test/call' } as any).apiUrl === null, 'a plain http endpoint is refused');
check(bolifyApiConfig({ BOLIFY_API_KEY: KEY, BOLIFY_ASSISTANT_ID: 'bad id!' } as any).assistantId === BOLIFY_DEFAULT_ASSISTANT_ID, 'a malformed assistant id falls back to the default');
check(bolifyDate('2026-11-20') === '20 Nov 2026' && bolifyDate('2026-12-31') === '31 Dec 2026', 'calendar dates never shift by a day');

const pb = bolifyApiPayload(recharge, dc);
check(JSON.stringify(Object.keys(pb)) === JSON.stringify(['first_name', 'last_name', 'email', 'phone_number', 'assistant_id', 'dialer_id', 'description']), 'the body has the fields of the BolifyAI API', pb);
check(pb.first_name === 'Meera' && pb.last_name === 'Joshi' && pb.phone_number.length === 1 && pb.phone_number[0] === '+919820000123'
      && pb.assistant_id === BOLIFY_DEFAULT_ASSISTANT_ID && pb.dialer_id === BOLIFY_DEFAULT_DIALER_ID, 'and their values', pb);
check(pb.description === 'Panel recharge reminder: AI Calling expires on 20 Nov 2026 (7 days left).', 'the description says what the call is about', pb.description);
check(bolifyApiPayload({ ...recharge, daysLeft: 1 }, dc).description.endsWith('(1 day left).'), '1 day left');
check(bolifyApiPayload({ ...recharge, firstName: '', lastName: '' }, dc).first_name === 'Joshi Sweets', 'no name: the business name');
check(bolifyApiPayload(recharge, { ...dc, phoneFormat: '91' }).phone_number[0] === '919820000123', 'the number format is configurable');

let req: { url: string; init: any } | null = null;
r = await new BolifyApiSender(apiCfg(), fake(200, '{"success":true,"message":"Call initiated for 919820000123","data":{"call_id":"bf-91"}}', (url, init) => (req = { url, init }))).place(recharge);
check(r.outcome === 'ACCEPTED' && r.callId === 'bf-91' && r.code === 200, 'a 2xx is accepted (submitted), with the call id', r);
check(req!.url === BOLIFY_DEFAULT_API_URL && req!.init.method === 'POST' && req!.init.headers['x-api-key'] === KEY && req!.init.headers['content-type'] === 'application/json'
      && !req!.init.headers.authorization && req!.init.headers['idempotency-key'] === 'rem-7', 'POST with x-api-key, JSON and the reminder id as the idempotency key');
check((r as any).response.message === 'Call initiated for [number]' && (r as any).response.success === true && (r as any).response.httpStatus === 200, 'the reply is kept without the full number', (r as any).response);
check(!JSON.stringify(r).includes(KEY), 'the key never appears in the result');
r = await new BolifyApiSender(apiCfg(), fake(200, '{"success":false,"message":"Dialer busy"}')).place(recharge);
check(r.outcome === 'FAILED' && /Dialer busy/.test(r.detail), 'a 2xx that says success: false is a failure, not a submission', r);
for (const st of [429, 503]) {
  r = await new BolifyApiSender(apiCfg(), fake(st, 'busy')).place(recharge);
  check(r.outcome === 'RETRY' && r.code === st, `HTTP ${st}: BolifyAI did not take it, tried again later`, r);
}
for (const st of [500, 502, 504]) {
  r = await new BolifyApiSender(apiCfg(), fake(st, 'oops')).place(recharge);
  check(r.outcome === 'FAILED' && /Not retried/.test(r.detail), `HTTP ${st}: failed and not retried (the call may have been placed)`, r);
}
for (const st of [400, 401, 403, 422]) {
  r = await new BolifyApiSender(apiCfg(), fake(st, `{"error":"bad key ${KEY} for 9820000123"}`)).place(recharge);
  check(r.outcome === 'FAILED' && r.code === st && !JSON.stringify(r).includes(KEY), `HTTP ${st}: refused, and the key is never echoed into the record`, r);
}
r = await new BolifyApiSender(apiCfg({ timeoutMs: 1000 }), (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))).place(recharge);
check(r.outcome === 'FAILED' && /did not answer/.test(r.detail) && /not retried/.test(r.detail), 'a timeout: the result is unknown, so it is FAILED and never retried blindly (no duplicate call)', r);
r = await new BolifyApiSender(apiCfg(), async () => { throw new Error(`ECONNRESET ${KEY}`); }).place(recharge);
check(r.outcome === 'FAILED' && !r.detail.includes(KEY) && !/ECONNRESET/.test(r.detail), 'a lost connection: failed, not retried, nothing of the error stored', r);

hits = 0;
r = await new BolifyApiSender(apiCfg(), counting).place({ ...recharge, phone: '12345' });
check(r.outcome === 'FAILED' && hits === 0, 'an invalid number never reaches BolifyAI');
r = await new BolifyApiSender(apiCfg({ apiKey: null }), counting).place(recharge);
check(r.outcome === 'FAILED' && hits === 0 && /BOLIFY_API_KEY/.test(r.detail), 'with no key nothing is sent');
r = await new BolifyApiSender(apiCfg(), counting).place({ ...recharge, firstName: '', lastName: '', company: null });
check(r.outcome === 'FAILED' && hits === 0, 'missing customer name: not sent');
process.env.AUTOMATION_TEST_RECIPIENTS = '9811122233';
r = await new BolifyApiSender(apiCfg(), counting).place(recharge);
check(r.outcome === 'SKIPPED' && hits === 0, 'safe test mode: a number outside AUTOMATION_TEST_RECIPIENTS is never called');
r = await new BolifyApiSender(apiCfg(), counting).place({ ...recharge, phone: '+919811122233' });
check(r.outcome === 'ACCEPTED' && hits === 1, 'only the tester\'s own number is called');
delete process.env.AUTOMATION_TEST_RECIPIENTS;
sent = null;
r = await new BolifyApiSender(apiCfg(), fake(200, '{}', (_u, init) => (sent = JSON.parse(init.body)))).callCustomer({ name: 'Ravi Kumar Rao', phone: '9820000456', email: null, city: null }, ['AI Calling']);
check(r.outcome === 'ACCEPTED' && sent.first_name === 'Ravi' && sent.last_name === 'Kumar Rao' && sent.phone_number[0] === '+919820000456', 'on demand through the API', sent);

// the call result callback (provisional field names)
const cr = bolifyCallResult({ call_id: 'bf-91', status: 'completed', duration: 95.4 });
check(cr?.callId === 'bf-91' && cr.outcome === 'COMPLETED' && cr.durationSeconds === 95, 'a completed call result', cr);
check(bolifyCallResult({ data: { callId: 'x' }, status: 'no-answer' })?.outcome === 'NOT_ANSWERED' && bolifyCallResult({ id: 'x', status: 'BUSY' })?.outcome === 'BUSY'
      && bolifyCallResult({ id: 'x', status: 'failed' })?.outcome === 'FAILED', 'not answered, busy and failed');
check(bolifyCallResult({ id: 'x', status: 'ringing' })?.outcome === null && bolifyCallResult({ status: 'completed' }) === null && bolifyCallResult(null) === null, 'an in-progress status is ignored; no call id is refused');
check(bolifyCallResult({ id: 'x', status: 'completed', duration: -5, detail: 'call 9820000123' })?.durationSeconds === null
      && bolifyCallResult({ id: 'x', status: 'completed', detail: 'call 9820000123' })?.detail === 'call [number]', 'a bad duration is dropped; numbers in the detail are hidden');

console.log(`=== ${passed} checks passed`);
