/**
 * The BolifyAI webhook sender (server/automations/bolify.ts): the request is exactly the five fields of the Google Sheet script,
 * a 2xx is "accepted", busy/unavailable is retried, a refused request is not, and staging allow-lists and bad numbers never reach the webhook.
 */
import { BOLIFY_API_URL, BolifyWebhookSender, bolifyApiPayload, bolifyConfig, bolifyPayload, bolifyPhone, bolifySender, reminderDescription, type BolifyFetch } from '../../server/automations/bolify.js';
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


// ============================================================================================================================ the API itself
// (the call the Google Sheet script makes: POST api.bolifyai.com/api/v1/playground/call, key in x-api-key)
const ASSISTANT = '567eaefd-bc8f-42c2-8bff-c1d1ac2f97ba', DIALER = 'c19c9cff-d96d-48b7-b163-1c62be020e6d';
const apiEnv = { BOLIFY_API_KEY: 'key-abc', BOLIFY_ASSISTANT_ID: ASSISTANT, BOLIFY_DIALER_ID: DIALER } as any;
const apiCfg = (over: Record<string, string> = {}) => bolifyConfig({ ...apiEnv, ...over });
check(apiCfg().api?.url === BOLIFY_API_URL && BOLIFY_API_URL === 'https://api.bolifyai.com/api/v1/playground/call', 'the API address is BolifyAI\'s call endpoint by default');
check(bolifySender(apiEnv) !== null && bolifySender({} as any) === null, 'with the key, the assistant and the dialer set, there is a sender');
for (const drop of ['BOLIFY_API_KEY', 'BOLIFY_ASSISTANT_ID', 'BOLIFY_DIALER_ID']) {
  const e = { ...apiEnv }; delete e[drop];
  check(bolifyConfig(e).api === null && bolifySender(e) === null, `without ${drop} the API is not used (and with no webhook either, nothing can be called)`);
}
check(bolifyConfig({ ...apiEnv, BOLIFY_ASSISTANT_ID: 'not-an-id' }).api === null && bolifyConfig({ ...apiEnv, BOLIFY_DIALER_ID: '123' }).api === null, 'the assistant and dialer ids must be ids');
check(bolifyConfig({ ...apiEnv, BOLIFY_API_URL: 'http://api.example.test/x' }).api === null && bolifyConfig({ ...apiEnv, BOLIFY_API_URL: 'http://127.0.0.1:1/x' }).api !== null, 'a plain http API address is refused except for a local test server');
check(bolifySender({ ...apiEnv, BOLIFY_WEBHOOK_URL: 'https://hooks.example.test/x' } as any) !== null && bolifyConfig({ ...apiEnv, BOLIFY_WEBHOOK_URL: 'https://hooks.example.test/x' } as any).api !== null, 'with both set the API is the one used');

const rem: ReminderCall = { ...call, daysLeft: 7, stage: 7, expiryDate: '2026-11-09' };
let apiHit: { url: string; headers: Record<string, string>; body: any } | null = null;
const apiFake = (status = 200, body = '{"data":{"call_id":"X1"}}'): BolifyFetch => async (url, init) => { apiHit = { url, headers: init.headers, body: JSON.parse(init.body) }; return { status, text: async () => body }; };
let ar = await new BolifyWebhookSender(apiCfg(), apiFake()).place(rem);
check(ar.outcome === 'ACCEPTED' && ar.callId === 'X1' && apiHit!.url === BOLIFY_API_URL, 'a reminder is posted to the API and a call id is read from the reply');
check(Object.keys(apiHit!.body).join() === 'first_name,last_name,email,phone_number,assistant_id,dialer_id,description'
  && apiHit!.body.first_name === 'Meera' && apiHit!.body.last_name === 'Joshi' && apiHit!.body.email === 'meera@joshi.example' && apiHit!.body.phone_number.join() === '+919820000123'
  && apiHit!.body.assistant_id === ASSISTANT && apiHit!.body.dialer_id === DIALER && apiHit!.body.description === '', 'the body is exactly the sheet script\'s, with an empty description unless context is on');
check(apiHit!.headers['x-api-key'] === 'key-abc' && !('authorization' in apiHit!.headers) && apiHit!.headers['content-type'] === 'application/json', 'the key goes in x-api-key (not as a Bearer token)');
await new BolifyWebhookSender(apiCfg({ BOLIFY_INCLUDE_CONTEXT: 'true' }), apiFake()).place(rem);
check(/^Reminder: AI Calling \(Gold plan\) for Joshi Sweets expires on 2026-11-09, in 7 days\. Reference rem-1\.$/.test(apiHit!.body.description), 'with BOLIFY_INCLUDE_CONTEXT the description says what the call is about', apiHit!.body.description);
check(reminderDescription({ ...rem, daysLeft: 1, planName: null, company: null }) === 'Reminder: AI Calling expires on 2026-11-09, tomorrow. Reference rem-1.', 'a one-day reminder says "tomorrow", and a missing plan or company is left out');
check(bolifyApiPayload({ firstName: '', lastName: '', email: null, phone: '+919820000123', description: 'x' }, { assistantId: ASSISTANT, dialerId: DIALER }, true).last_name === '-', 'a customer with one name gets "-" as the last name (the sheet required one)');
check(bolifyApiPayload({ firstName: 'A', lastName: 'B', email: null, phone: '+919820000123', description: 'y'.repeat(2000) }, { assistantId: ASSISTANT, dialerId: DIALER }, true).description.length === 1000, 'a long description is cut');

// what the API's replies mean
check((await new BolifyWebhookSender(apiCfg(), apiFake(503, 'down')).place(rem)).outcome === 'RETRY', 'the API busy (503) is tried again');
ar = await new BolifyWebhookSender(apiCfg(), apiFake(401, '{"error":"bad key"}')).place(rem);
check(ar.outcome === 'FAILED' && /API key, assistant and dialer/.test(ar.detail) && !/bad key/.test(ar.detail), 'a refused key fails at once, names what to check, and does not store the reply');
check((await new BolifyWebhookSender(apiCfg(), apiFake()).place({ ...rem, phone: '12345' })).outcome === 'FAILED', 'a number that is not an Indian mobile never reaches the API');
process.env.AUTOMATION_TEST_RECIPIENTS = '9820000999';
apiHit = null;
ar = await new BolifyWebhookSender(apiCfg(), apiFake()).place(rem);
check(ar.outcome === 'SKIPPED' && apiHit === null, 'the staging allow-list holds for the API too');
delete process.env.AUTOMATION_TEST_RECIPIENTS;

// on demand: the customer's name is split
await new BolifyWebhookSender(apiCfg(), apiFake()).callCustomer({ name: 'Ravi Kumar Singh', phone: '9820000456', email: null, city: 'Nashik' }, ['AI Calling']);
check(apiHit!.body.first_name === 'Ravi' && apiHit!.body.last_name === 'Kumar Singh' && apiHit!.body.phone_number[0] === '+919820000456' && apiHit!.body.email === '' && apiHit!.body.description === '', 'an on-demand call sends first and last name, the number as a list and no description by default');
await new BolifyWebhookSender(apiCfg({ BOLIFY_INCLUDE_CONTEXT: 'true' }), apiFake()).callCustomer({ name: 'Ravi', phone: '9820000456', email: null, city: null }, ['AI Calling', 'WhatsApp API']);
check(apiHit!.body.last_name === '-' && apiHit!.body.description === 'Services: AI Calling, WhatsApp API', 'one name gives "-" as the last name; the services are the description when context is on');
check(bolifyConfig({ ...apiEnv, BOLIFY_PHONE_FORMAT: '10' }).phoneFormat === '10', 'the number can be written the way the sheet had it (10 digits, 91..., +91...)');

console.log(`=== ${passed} checks passed`);
